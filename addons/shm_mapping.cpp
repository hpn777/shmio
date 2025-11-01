#include "shm_mapping.h"

#include <errno.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>

#include <cstring>
#include <string>
#include <limits>

#include "shm_iterator.h"
#include "shm_writer.h"

namespace {
constexpr uint64_t kDefaultHeaderSize = 24; // 3 * u64 (headerSize, dataOffset, size)
}

Napi::FunctionReference ShmMapping::constructor_;

void ShmMapping::Init(Napi::Env env, Napi::Object exports) {
  Napi::Function func = DefineClass(env, "ShmMapping", {
    InstanceMethod<&ShmMapping::HeaderView>("headerView"),
    InstanceMethod<&ShmMapping::CreateIterator>("createIterator"),
    InstanceMethod<&ShmMapping::CreateWriter>("createWriter"),
    InstanceMethod<&ShmMapping::Close>("close"),
  });

  constructor_ = Napi::Persistent(func);
  constructor_.SuppressDestruct();

  exports.Set("ShmMapping", func);
  exports.Set("openSharedLog", Napi::Function::New(env, ShmMapping::Open));
}

Napi::Value ShmMapping::Open(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsObject()) {
    Napi::TypeError::New(env, "openSharedLog(options) expects an options object").ThrowAsJavaScriptException();
    return env.Null();
  }

  Napi::Object opts = info[0].As<Napi::Object>();

  auto pathValue = opts.Get("path");
  if (!pathValue.IsString()) {
    Napi::TypeError::New(env, "options.path must be a string").ThrowAsJavaScriptException();
    return env.Null();
  }

  bool writable = opts.Has("writable") ? opts.Get("writable").ToBoolean().Value() : false;
  bool debugChecks = opts.Has("debugChecks") ? opts.Get("debugChecks").ToBoolean().Value() : false;

  bool lossless = false;
  uint64_t capacityBytes = 0;

  bool hasCapacity = opts.Has("capacityBytes");
  Napi::Value capacityValue = hasCapacity ? opts.Get("capacityBytes") : env.Undefined();

  if (hasCapacity && !capacityValue.IsUndefined() && !capacityValue.IsNull()) {
    if (!capacityValue.IsBigInt() && !capacityValue.IsNumber()) {
      Napi::TypeError::New(env, "options.capacityBytes must be a number or bigint").ThrowAsJavaScriptException();
      return env.Null();
    }

    if (capacityValue.IsBigInt()) {
      capacityBytes = capacityValue.As<Napi::BigInt>().Uint64Value(&lossless);
    } else {
      capacityBytes = static_cast<uint64_t>(capacityValue.As<Napi::Number>().DoubleValue());
      lossless = true;
    }

    if (!lossless) {
      Napi::TypeError::New(env, "capacityBytes must fit into uint64").ThrowAsJavaScriptException();
      return env.Null();
    }
  } else {
    if (writable) {
      Napi::TypeError::New(env, "capacityBytes is required when writable is true").ThrowAsJavaScriptException();
      return env.Null();
    }

    capacityBytes = kDefaultHeaderSize;
    lossless = true;
  }

  if (capacityBytes < kDefaultHeaderSize) {
    Napi::TypeError::New(env, "capacityBytes must be at least 24 bytes").ThrowAsJavaScriptException();
    return env.Null();
  }

  Napi::Object instance = constructor_.New({
    pathValue,
    Napi::BigInt::New(env, capacityBytes),
    Napi::Boolean::New(env, writable),
    Napi::Boolean::New(env, debugChecks),
  });

  return instance;
}

ShmMapping::ShmMapping(const Napi::CallbackInfo& info)
  : Napi::ObjectWrap<ShmMapping>(info) {
  Napi::Env env = info.Env();

  if (info.Length() < 4) {
    Napi::TypeError::New(env, "ShmMapping constructor expects (path, capacityBytes, writable, debugChecks)")
      .ThrowAsJavaScriptException();
    return;
  }

  std::string path = info[0].As<Napi::String>().Utf8Value();

  bool lossless = false;
  uint64_t capacityBytes = info[1].As<Napi::BigInt>().Uint64Value(&lossless);
  if (!lossless) {
    Napi::TypeError::New(env, "capacityBytes must fit into uint64").ThrowAsJavaScriptException();
    return;
  }

  writable_ = info[2].As<Napi::Boolean>().Value();
  debugChecks_ = info[3].As<Napi::Boolean>().Value();

  int flags = writable_ ? (O_RDWR) : O_RDONLY;
  int permissions = 0664;

  bool created = false;

  fd_ = open(path.c_str(), flags, permissions);
  if (fd_ < 0) {
    if (!writable_) {
      Napi::Error::New(env, std::string("Unable to open shared memory ") + strerror(errno)).ThrowAsJavaScriptException();
      return;
    }

    fd_ = open(path.c_str(), O_RDWR | O_CREAT, permissions);
    if (fd_ < 0) {
      Napi::Error::New(env, std::string("Unable to create shared memory ") + strerror(errno)).ThrowAsJavaScriptException();
      return;
    }

    created = true;

    if (ftruncate(fd_, static_cast<off_t>(capacityBytes)) != 0) {
      Napi::Error::New(env, std::string("ftruncate failed: ") + strerror(errno)).ThrowAsJavaScriptException();
      close(fd_);
      fd_ = -1;
      return;
    }
  }

  struct stat st {};
  if (fstat(fd_, &st) != 0) {
    Napi::Error::New(env, std::string("fstat failed: ") + strerror(errno)).ThrowAsJavaScriptException();
    close(fd_);
    fd_ = -1;
    return;
  }

  if (st.st_size < static_cast<off_t>(kDefaultHeaderSize)) {
    if (created) {
      st.st_size = static_cast<off_t>(capacityBytes);
    } else {
      Napi::Error::New(env, "shared memory segment is smaller than minimum header size").ThrowAsJavaScriptException();
      close(fd_);
      fd_ = -1;
      return;
    }
  }

  if (st.st_size <= 0) {
    Napi::Error::New(env, "shared memory segment has zero length").ThrowAsJavaScriptException();
    close(fd_);
    fd_ = -1;
    return;
  }

  uint64_t mappingLength = static_cast<uint64_t>(st.st_size);
  if (mappingLength > std::numeric_limits<size_t>::max()) {
    Napi::Error::New(env, "shared memory segment is too large to map").ThrowAsJavaScriptException();
    close(fd_);
    fd_ = -1;
    return;
  }

  int protection = writable_ ? (PROT_READ | PROT_WRITE) : PROT_READ;
  void* mapped = mmap(nullptr, static_cast<size_t>(mappingLength), protection, MAP_SHARED, fd_, 0);
  if (mapped == MAP_FAILED) {
    Napi::Error::New(env, std::string("mmap failed: ") + strerror(errno)).ThrowAsJavaScriptException();
    close(fd_);
    fd_ = -1;
    return;
  }

  base_ = static_cast<uint8_t*>(mapped);
  length_ = static_cast<size_t>(mappingLength);

  mappingBufferRef_ = Napi::Persistent(Napi::Buffer<uint8_t>::New(env, base_, length_));
  mappingBufferRef_.SuppressDestruct();

  headerSize_ = ReadUint64LE(base_);
  if (headerSize_ == 0 || headerSize_ > length_) {
    headerSize_ = kDefaultHeaderSize;
    WriteUint64LE(base_, headerSize_);
  }

  dataOffset_ = ReadUint64LE(base_ + 8);
  if (dataOffset_ == 0 || dataOffset_ > length_) {
    dataOffset_ = headerSize_;
    WriteUint64LE(base_ + 8, dataOffset_);
  }

  committedSizeAtomic_ = reinterpret_cast<std::atomic<uint64_t>*>(base_ + 16);

  uint64_t committed = committedSizeAtomic_->load(std::memory_order_acquire);
  if (committed < dataOffset_ || committed > length_) {
    committed = dataOffset_;
    committedSizeAtomic_->store(committed, std::memory_order_release);
  }
}

ShmMapping::~ShmMapping() {
  Cleanup();
}

uint64_t ShmMapping::LoadCommittedSize() const {
  if (committedSizeAtomic_ == nullptr) {
    return 0;
  }
  return committedSizeAtomic_->load(std::memory_order_acquire);
}

void ShmMapping::StoreCommittedSize(uint64_t value) {
  if (committedSizeAtomic_ == nullptr) {
    return;
  }
  committedSizeAtomic_->store(value, std::memory_order_release);
}

void ShmMapping::EnsureOpen(Napi::Env env) const {
  if (closed_) {
    Napi::Error::New(env, "Shared log mapping is closed").ThrowAsJavaScriptException();
  }
}

Napi::Value ShmMapping::HeaderView(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  EnsureOpen(env);
  return Napi::Buffer<uint8_t>::New(env, base_, static_cast<size_t>(headerSize_));
}

Napi::Value ShmMapping::CreateIterator(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  EnsureOpen(env);

  uint64_t startCursor = 0;
  if (info.Length() >= 1 && info[0].IsObject()) {
    Napi::Object options = info[0].As<Napi::Object>();
    if (options.Has("startCursor")) {
      Napi::Value cursorValue = options.Get("startCursor");
      if (!cursorValue.IsBigInt()) {
        Napi::TypeError::New(env, "startCursor must be a BigInt").ThrowAsJavaScriptException();
        return env.Null();
      }
      bool lossless = false;
      startCursor = cursorValue.As<Napi::BigInt>().Uint64Value(&lossless);
      if (!lossless) {
        Napi::TypeError::New(env, "startCursor must fit into uint64").ThrowAsJavaScriptException();
        return env.Null();
      }
    }
  } else if (info.Length() >= 1 && !info[0].IsUndefined() && !info[0].IsNull()) {
    Napi::TypeError::New(env, "createIterator options must be an object").ThrowAsJavaScriptException();
    return env.Null();
  }

  Napi::Value external = Napi::External<ShmMapping>::New(env, this);
  Napi::Object self = info.This().As<Napi::Object>();
  Napi::Object iterator = ShmIterator::constructor_.New({
    external,
    self,
    Napi::BigInt::New(env, startCursor),
  });

  return iterator;
}

Napi::Value ShmMapping::CreateWriter(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  EnsureOpen(env);

  if (!writable_) {
    Napi::Error::New(env, "Shared log is read-only").ThrowAsJavaScriptException();
    return env.Null();
  }

  bool debugChecks = debugChecks_;
  if (info.Length() >= 1 && info[0].IsObject()) {
    Napi::Object options = info[0].As<Napi::Object>();
    if (options.Has("debugChecks")) {
      debugChecks = options.Get("debugChecks").ToBoolean().Value();
    }
  } else if (info.Length() >= 1 && !info[0].IsUndefined() && !info[0].IsNull()) {
    Napi::TypeError::New(env, "createWriter options must be an object").ThrowAsJavaScriptException();
    return env.Null();
  }

  Napi::Value external = Napi::External<ShmMapping>::New(env, this);
  Napi::Object self = info.This().As<Napi::Object>();
  Napi::Object writer = ShmWriter::constructor_.New({
    external,
    self,
    Napi::Boolean::New(env, debugChecks),
  });

  return writer;
}

void ShmMapping::Close(const Napi::CallbackInfo& info) {
  Cleanup();
}

void ShmMapping::Cleanup() {
  if (closed_) {
    return;
  }

  closed_ = true;

  if (base_ != nullptr && length_ > 0) {
    munmap(base_, length_);
    base_ = nullptr;
    length_ = 0;
  }

  if (fd_ >= 0) {
    close(fd_);
    fd_ = -1;
  }

  if (!mappingBufferRef_.IsEmpty()) {
    mappingBufferRef_.Reset();
  }
}

uint64_t ShmMapping::ReadUint64LE(const uint8_t* data) {
  uint64_t value = 0;
  for (int i = 7; i >= 0; --i) {
    value = (value << 8) | data[i];
  }
  return value;
}

void ShmMapping::WriteUint64LE(uint8_t* data, uint64_t value) {
  for (size_t i = 0; i < 8; ++i) {
    data[i] = static_cast<uint8_t>((value >> (8 * i)) & 0xff);
  }
}
