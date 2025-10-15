#include "shm_iterator.h"
#include "shm_mapping.h"

#include <algorithm>
#include <cstdint>
#include <limits>
#include <stdexcept>
#include <string>

namespace {
constexpr uint32_t kDefaultMaxMessages = 64;
constexpr uint32_t kDefaultMaxBytes = 256 * 1024;
constexpr uint32_t kFrameMetadataBytes = 4; // 2-byte prefix + 2-byte suffix

inline void NoopFinalize(Napi::Env /*env*/, uint8_t* /*data*/) {}
}

Napi::FunctionReference ShmIterator::constructor_;

void ShmIterator::Init(Napi::Env env, Napi::Object exports) {
  Napi::Function func = DefineClass(env, "ShmIterator", {
    InstanceMethod<&ShmIterator::Next>("next"),
    InstanceMethod<&ShmIterator::NextBatch>("nextBatch"),
    InstanceMethod<&ShmIterator::Cursor>("cursor"),
    InstanceMethod<&ShmIterator::CommittedSize>("committedSize"),
    InstanceMethod<&ShmIterator::Seek>("seek"),
    InstanceMethod<&ShmIterator::Close>("close"),
  });

  constructor_ = Napi::Persistent(func);
  constructor_.SuppressDestruct();

  exports.Set("ShmIterator", func);
}

ShmIterator::ShmIterator(const Napi::CallbackInfo& info)
  : Napi::ObjectWrap<ShmIterator>(info) {
  Napi::Env env = info.Env();

  bool usingMapping = info.Length() >= 2 && info[0].IsExternal();

  if (usingMapping) {
    mapping_ = info[0].As<Napi::External<ShmMapping>>().Data();
    mappingRef_ = Napi::Persistent(info[1].As<Napi::Object>());
    mappingRef_.SuppressDestruct();

    base_ = mapping_->base();
    mappingLength_ = mapping_->length();
    headerSize_ = mapping_->headerSize();
    dataOffset_ = mapping_->dataOffset();
    committedSizeAtomic_ = mapping_->committedSizeAtomic();

    bool lossless = false;
    uint64_t startCursor = 0;
    if (info.Length() >= 3 && info[2].IsBigInt()) {
      startCursor = info[2].As<Napi::BigInt>().Uint64Value(&lossless);
      if (!lossless) {
        ThrowWithCode(env, "startCursor must fit into uint64", "ERR_SHM_CURSOR");
        return;
      }
    }

    if (mapping_ == nullptr || base_ == nullptr || mappingLength_ < 24) {
      ThrowWithCode(env, "Invalid mapping provided to ShmIterator", "ERR_SHM_MAPPING_GONE");
      return;
    }

    uint64_t committedSnapshot = LoadCommittedSize();
    uint64_t committedRelative = committedSnapshot > dataOffset_ ? committedSnapshot - dataOffset_ : 0;
    if (startCursor > committedRelative) {
      ThrowWithCode(env, "start cursor is beyond committed size", "ERR_SHM_CURSOR");
      return;
    }

    cursor_ = startCursor;
    return;
  }

  if (info.Length() < 2) {
    ThrowWithCode(env, "ShmIterator constructor expects at least 2 arguments", "ERR_SHM_CURSOR");
    return;
  }

  if (!info[0].IsBuffer()) {
    ThrowWithCode(env, "ShmIterator requires a Buffer as the first argument", "ERR_SHM_MAPPING_GONE");
    return;
  }

  bool lossless = false;
  uint64_t mappingLength = 0;
  if (info[1].IsNumber()) {
    mappingLength = info[1].As<Napi::Number>().Uint32Value();
    lossless = true;
  } else if (info[1].IsBigInt()) {
    mappingLength = info[1].As<Napi::BigInt>().Uint64Value(&lossless);
  } else {
    ThrowWithCode(env, "ShmIterator length must be a BigInt", "ERR_SHM_CURSOR");
    return;
  }

  if (!lossless) {
    ThrowWithCode(env, "ShmIterator length must fit into uint64", "ERR_SHM_CURSOR");
    return;
  }

  Napi::Buffer<uint8_t> baseBuffer = info[0].As<Napi::Buffer<uint8_t>>();
  baseBufferRef_ = Napi::Persistent(baseBuffer);
  base_ = baseBuffer.Data();
  mappingLength_ = mappingLength;

  if (base_ == nullptr || mappingLength_ < 24) {
    ThrowWithCode(env, "Invalid mapping provided to ShmIterator", "ERR_SHM_MAPPING_GONE");
    return;
  }

  headerSize_ = ReadUint64LE(base_);
  dataOffset_ = ReadUint64LE(base_ + 8);
  committedSizeAtomic_ = reinterpret_cast<std::atomic<uint64_t>*>(base_ + 16);

  if (dataOffset_ > mappingLength_) {
    ThrowWithCode(env, "dataOffset exceeds mapping length", "ERR_SHM_CURSOR");
    return;
  }

  uint64_t committedSnapshot = LoadCommittedSize();
  uint64_t committedRelative = committedSnapshot > dataOffset_ ? committedSnapshot - dataOffset_ : 0;

  uint64_t startCursor = 0;
  if (info.Length() >= 3) {
    if (!info[2].IsBigInt()) {
      ThrowWithCode(env, "startCursor must be a BigInt", "ERR_SHM_CURSOR");
      return;
    }
    startCursor = info[2].As<Napi::BigInt>().Uint64Value(&lossless);
    if (!lossless) {
      ThrowWithCode(env, "startCursor must fit into uint64", "ERR_SHM_CURSOR");
      return;
    }
  }

  if (startCursor > committedRelative) {
    ThrowWithCode(env, "start cursor is beyond committed size", "ERR_SHM_CURSOR");
    return;
  }

  cursor_ = startCursor;
}

Napi::Value ShmIterator::Next(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  EnsureOpen(env);

  BatchOptions options {
    1u,
    std::numeric_limits<uint32_t>::max(),
    false
  };

  BatchResult result = CollectFrames(env, options);
  if (result.frames.empty()) {
    return env.Null();
  }

  cursor_ += result.consumedBytes;
  const auto& slice = result.frames.front();
  return Napi::Buffer<uint8_t>::New(env, slice.ptr, slice.length, NoopFinalize);
}

Napi::Value ShmIterator::NextBatch(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  EnsureOpen(env);

  BatchOptions options {
    kDefaultMaxMessages,
    kDefaultMaxBytes,
    false
  };

  if (info.Length() >= 1 && info[0].IsObject()) {
    options = ParseOptions(env, info[0].As<Napi::Object>());
  } else if (info.Length() >= 1 && !info[0].IsUndefined() && !info[0].IsNull()) {
    ThrowWithCode(env, "nextBatch options must be an object", "ERR_SHM_CURSOR");
    return env.Null();
  }

  BatchResult result = CollectFrames(env, options);
  cursor_ += result.consumedBytes;

  Napi::Array output = Napi::Array::New(env, result.frames.size());
  for (size_t i = 0; i < result.frames.size(); ++i) {
    const auto& slice = result.frames[i];
    output.Set(i, Napi::Buffer<uint8_t>::New(env, slice.ptr, slice.length, NoopFinalize));
  }
  return output;
}

Napi::Value ShmIterator::Cursor(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  EnsureOpen(env);
  return Napi::BigInt::New(env, cursor_);
}

Napi::Value ShmIterator::CommittedSize(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  EnsureOpen(env);

  uint64_t committedSnapshot = LoadCommittedSize();
  if (committedSnapshot < dataOffset_) {
    ThrowWithCode(env, "Committed size precedes data offset", "ERR_SHM_CURSOR");
    return env.Null();
  }

  return Napi::BigInt::New(env, committedSnapshot - dataOffset_);
}

void ShmIterator::Seek(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  EnsureOpen(env);

  if (info.Length() < 1 || !info[0].IsBigInt()) {
    ThrowWithCode(env, "seek(position) expects a BigInt", "ERR_SHM_CURSOR");
    return;
  }

  bool lossless = false;
  uint64_t position = info[0].As<Napi::BigInt>().Uint64Value(&lossless);
  if (!lossless) {
    ThrowWithCode(env, "seek position must fit into uint64", "ERR_SHM_CURSOR");
    return;
  }

  uint64_t committedSnapshot = LoadCommittedSize();
  if (committedSnapshot < dataOffset_) {
    ThrowWithCode(env, "Committed size precedes data offset", "ERR_SHM_CURSOR");
    return;
  }
  uint64_t committedRelative = committedSnapshot - dataOffset_;

  if (position > committedRelative) {
    ThrowWithCode(env, "Seek position beyond committed size", "ERR_SHM_CURSOR");
    return;
  }

  cursor_ = position;
}

void ShmIterator::Close(const Napi::CallbackInfo& info) {
  if (closed_) {
    return;
  }
  closed_ = true;
  base_ = nullptr;
  mappingLength_ = 0;
  committedSizeAtomic_ = nullptr;
  baseBufferRef_.Reset();
  if (!mappingRef_.IsEmpty()) {
    mappingRef_.Reset();
  }
  mapping_ = nullptr;
}

ShmIterator::BatchOptions ShmIterator::ParseOptions(Napi::Env env, const Napi::Object& value) const {
  BatchOptions options {
    kDefaultMaxMessages,
    kDefaultMaxBytes,
    false
  };

  if (value.Has("maxMessages")) {
    Napi::Value v = value.Get("maxMessages");
    if (!v.IsNumber()) {
      ThrowWithCode(env, "maxMessages must be a number", "ERR_SHM_CURSOR");
      return options;
    }
    int64_t mm = v.As<Napi::Number>().Int64Value();
    if (mm <= 0 || mm > std::numeric_limits<uint32_t>::max()) {
      ThrowWithCode(env, "maxMessages must be > 0 and <= 2^32-1", "ERR_SHM_CURSOR");
      return options;
    }
    options.maxMessages = static_cast<uint32_t>(mm);
  }

  if (value.Has("maxBytes")) {
    Napi::Value v = value.Get("maxBytes");
    if (!v.IsNumber()) {
      ThrowWithCode(env, "maxBytes must be a number", "ERR_SHM_CURSOR");
      return options;
    }
    int64_t mb = v.As<Napi::Number>().Int64Value();
    if (mb <= 0 || mb > std::numeric_limits<uint32_t>::max()) {
      ThrowWithCode(env, "maxBytes must be > 0 and <= 2^32-1", "ERR_SHM_CURSOR");
      return options;
    }
    options.maxBytes = static_cast<uint32_t>(mb);
  }

  if (value.Has("debugChecks")) {
    Napi::Value v = value.Get("debugChecks");
    if (!v.IsBoolean()) {
      ThrowWithCode(env, "debugChecks must be boolean", "ERR_SHM_CURSOR");
      return options;
    }
    options.debugChecks = v.As<Napi::Boolean>().Value();
  }

  return options;
}

ShmIterator::BatchResult ShmIterator::CollectFrames(Napi::Env env, const BatchOptions& options) {
  Napi::HandleScope scope(env);
  BatchResult result;
  result.consumedBytes = 0;

  if (base_ == nullptr || committedSizeAtomic_ == nullptr) {
    ThrowWithCode(env, "Shared memory mapping is unavailable", "ERR_SHM_MAPPING_GONE");
    return result;
  }

  uint64_t committedSnapshot = LoadCommittedSize();
  if (committedSnapshot < dataOffset_) {
    ThrowWithCode(env, "Committed size precedes data offset", "ERR_SHM_CURSOR");
    return result;
  }

  uint64_t committedRelative = committedSnapshot - dataOffset_;
  EnsureCursorInBounds(env, cursor_, committedRelative);

  uint64_t cursorRelative = cursor_;
  uint64_t cursorAbsolute = dataOffset_ + cursorRelative;
  uint64_t maxAbsolute = dataOffset_ + committedRelative;

  uint32_t messages = 0;
  uint64_t accumulatedBytes = 0;

  while (cursorRelative < committedRelative && messages < options.maxMessages) {
    if (cursorAbsolute + kFrameMetadataBytes > maxAbsolute) {
      break;
    }
    if (cursorAbsolute + kFrameMetadataBytes > mappingLength_) {
      ThrowWithCode(env, "Cursor beyond mapping length", "ERR_SHM_MAPPING_GONE");
      return result;
    }

    const uint8_t* framePtr = base_ + cursorAbsolute;
    uint16_t frameSize = ReadUint16LE(framePtr);

    if (frameSize < kFrameMetadataBytes) {
      ThrowWithCode(env, "Invalid frame size (too small)", options.debugChecks ? "ERR_SHM_FRAME_CORRUPT" : "ERR_SHM_CURSOR");
      return result;
    }

    uint64_t frameEndRelative = cursorRelative + frameSize;
    uint64_t frameEndAbsolute = cursorAbsolute + frameSize;

    if (frameEndRelative > committedRelative) {
      break; // partial frame, wait for more data
    }

    if (frameEndAbsolute > mappingLength_) {
      ThrowWithCode(env, "Frame exceeds mapping length", "ERR_SHM_MAPPING_GONE");
      return result;
    }

    if (accumulatedBytes + frameSize > options.maxBytes) {
      break;
    }

    if (options.debugChecks) {
      uint16_t suffix = ReadUint16LE(framePtr + frameSize - sizeof(uint16_t));
      if (suffix != frameSize) {
        ThrowWithCode(env, "Frame length mismatch between prefix and suffix", "ERR_SHM_FRAME_CORRUPT");
        return result;
      }
    }

    uint8_t* payloadPtr = base_ + cursorAbsolute + sizeof(uint16_t);
    size_t payloadLength = frameSize - kFrameMetadataBytes;

    result.frames.push_back(BatchResult::FrameSlice{ payloadPtr, payloadLength });

    ++messages;
    accumulatedBytes += frameSize;
    cursorRelative = frameEndRelative;
    cursorAbsolute = frameEndAbsolute;
  }

  result.consumedBytes = cursorRelative - cursor_;
  return result;
}

void ShmIterator::EnsureOpen(Napi::Env env) const {
  if (closed_) {
    const_cast<ShmIterator*>(this)->ThrowWithCode(env, "ShmIterator is closed", "ERR_SHM_ITERATOR_CLOSED");
  }
}

void ShmIterator::EnsureCursorInBounds(Napi::Env env, uint64_t cursorSnapshot, uint64_t committedSnapshot) const {
  if (cursorSnapshot > committedSnapshot) {
    ThrowWithCode(env, "Cursor beyond committed size", "ERR_SHM_CURSOR");
  }

  if (dataOffset_ + cursorSnapshot > mappingLength_) {
    ThrowWithCode(env, "Cursor exceeds mapping length", "ERR_SHM_MAPPING_GONE");
  }
}

[[noreturn]] void ShmIterator::ThrowWithCode(Napi::Env env, const std::string& message, const std::string& code) const {
  Napi::Error err = Napi::Error::New(env, message);
  err.Set("code", Napi::String::New(env, code));
  throw err;
}

uint64_t ShmIterator::LoadCommittedSize() const {
  if (committedSizeAtomic_ == nullptr) {
    return 0;
  }
  return committedSizeAtomic_->load(std::memory_order_acquire);
}

uint64_t ShmIterator::ReadUint64LE(const uint8_t* data) {
  uint64_t value = 0;
  for (int i = 7; i >= 0; --i) {
    value = (value << 8) | data[i];
  }
  return value;
}

uint16_t ShmIterator::ReadUint16LE(const uint8_t* data) {
  return static_cast<uint16_t>(data[0] | (static_cast<uint16_t>(data[1]) << 8));
}
