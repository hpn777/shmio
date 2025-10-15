#include "shm_writer.h"

#include <algorithm>
#include <atomic>
#include <limits>

#include "shm_mapping.h"

namespace {
constexpr uint32_t kMessageHeaderBytes = 2;
constexpr uint32_t kFrameMetadataBytes = kMessageHeaderBytes * 2;
}

Napi::FunctionReference ShmWriter::constructor_;

void ShmWriter::Init(Napi::Env env, Napi::Object exports) {
  Napi::Function func = DefineClass(env, "ShmWriter", {
    InstanceMethod<&ShmWriter::Allocate>("allocate"),
    InstanceMethod<&ShmWriter::Commit>("commit"),
    InstanceMethod<&ShmWriter::Close>("close"),
  });

  constructor_ = Napi::Persistent(func);
  constructor_.SuppressDestruct();

  exports.Set("ShmWriter", func);
}

ShmWriter::ShmWriter(const Napi::CallbackInfo& info)
  : Napi::ObjectWrap<ShmWriter>(info) {
  Napi::Env env = info.Env();

  if (info.Length() < 3 || !info[0].IsExternal() || !info[1].IsObject() || !info[2].IsBoolean()) {
    Napi::TypeError::New(env, "ShmWriter expects (External<ShmMapping>, mappingObject, debugChecks)")
      .ThrowAsJavaScriptException();
    return;
  }

  mapping_ = info[0].As<Napi::External<ShmMapping>>().Data();
  mappingRef_ = Napi::Persistent(info[1].As<Napi::Object>());
  mappingRef_.SuppressDestruct();
  debugChecks_ = info[2].As<Napi::Boolean>().Value();

  if (mapping_ != nullptr) {
    cursor_ = mapping_->LoadCommittedSize();
  }
}

ShmWriter::~ShmWriter() {
  if (!mappingRef_.IsEmpty()) {
    mappingRef_.Reset();
  }
}

void ShmWriter::EnsureOpen(Napi::Env env) const {
  if (closed_) {
    Napi::Error::New(env, "Shared log writer is closed").ThrowAsJavaScriptException();
    return;
  }
  if (mapping_ == nullptr) {
    Napi::Error::New(env, "Shared log mapping is unavailable").ThrowAsJavaScriptException();
    return;
  }
  mapping_->EnsureOpen(env);
}

Napi::Value ShmWriter::Allocate(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  EnsureOpen(env);

  if (info.Length() < 1 || !info[0].IsNumber()) {
    Napi::TypeError::New(env, "allocate(size) expects a number").ThrowAsJavaScriptException();
    return env.Null();
  }

  int64_t requested = info[0].As<Napi::Number>().Int64Value();
  if (requested <= 0) {
    Napi::RangeError::New(env, "allocate size must be positive").ThrowAsJavaScriptException();
    return env.Null();
  }

  uint32_t payloadSize = static_cast<uint32_t>(requested);
  uint32_t frameSize = payloadSize + kFrameMetadataBytes;

  uint64_t headerSize = mapping_->headerSize();
  uint64_t dataOffset = mapping_->dataOffset();
  uint64_t length = mapping_->length();
  uint8_t* base = mapping_->base();

  uint64_t writeCursor = cursor_ + pendingBytes_;
  if (writeCursor < dataOffset) {
    writeCursor = dataOffset;
  }

  if (writeCursor + frameSize > length) {
    Napi::Error::New(env, "Shared memory exhausted while allocating frame").ThrowAsJavaScriptException();
    return env.Null();
  }

  if (debugChecks_) {
    if (writeCursor > dataOffset && writeCursor >= headerSize + kFrameMetadataBytes) {
      uint64_t previousFrameEnd = writeCursor;
      uint64_t previousFrameSuffixOffset = previousFrameEnd - kMessageHeaderBytes;
      uint16_t previousFrameSize = ReadUint16LE(base + previousFrameSuffixOffset);
      if (previousFrameSize < kFrameMetadataBytes || previousFrameSize > std::numeric_limits<uint32_t>::max()) {
        Napi::Error::New(env, "[DEBUG] Invalid previous frame size").ThrowAsJavaScriptException();
        return env.Null();
      }
      uint64_t previousFrameStart = previousFrameEnd - previousFrameSize;
      if (previousFrameStart < dataOffset) {
        Napi::Error::New(env, "[DEBUG] Previous frame crosses data offset").ThrowAsJavaScriptException();
        return env.Null();
      }
      uint16_t leading = ReadUint16LE(base + previousFrameStart);
      if (leading != previousFrameSize) {
        Napi::Error::New(env, "[DEBUG] Frame corruption detected (prefix != suffix)").ThrowAsJavaScriptException();
        return env.Null();
      }
    }
  }

  uint8_t* framePtr = base + writeCursor;
  WriteUint16LE(framePtr, static_cast<uint16_t>(frameSize));
  WriteUint16LE(framePtr + frameSize - kMessageHeaderBytes, static_cast<uint16_t>(frameSize));

  uint8_t* payloadPtr = framePtr + kMessageHeaderBytes;

  pendingBytes_ += frameSize;

  return Napi::Buffer<uint8_t>::New(env, payloadPtr, payloadSize);
}

void ShmWriter::Commit(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  EnsureOpen(env);

  if (pendingBytes_ == 0) {
    return;
  }

  uint64_t newSize = cursor_ + pendingBytes_;
  mapping_->StoreCommittedSize(newSize);
  cursor_ = newSize;
  pendingBytes_ = 0;
}

void ShmWriter::Close(const Napi::CallbackInfo& info) {
  closed_ = true;
  pendingBytes_ = 0;
  if (!mappingRef_.IsEmpty()) {
    mappingRef_.Reset();
  }
  mapping_ = nullptr;
}

uint16_t ShmWriter::ReadUint16LE(const uint8_t* data) {
  return static_cast<uint16_t>(data[0] | (static_cast<uint16_t>(data[1]) << 8));
}

void ShmWriter::WriteUint16LE(uint8_t* data, uint16_t value) {
  data[0] = static_cast<uint8_t>(value & 0xff);
  data[1] = static_cast<uint8_t>((value >> 8) & 0xff);
}
