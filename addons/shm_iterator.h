#pragma once

#include <atomic>
#include <vector>
#include <napi.h>

class ShmMapping;

class ShmIterator : public Napi::ObjectWrap<ShmIterator> {
public:
  static void Init(Napi::Env env, Napi::Object exports);
  ShmIterator(const Napi::CallbackInfo& info);

private:
  friend class ShmMapping;
  struct BatchOptions {
    uint32_t maxMessages;
    uint32_t maxBytes;
    bool debugChecks;
  };

  struct BatchResult {
    struct FrameSlice {
      uint8_t* ptr;
      size_t length;
    };
    std::vector<FrameSlice> frames;
    uint64_t consumedBytes;
  };

  static Napi::FunctionReference constructor_;

  Napi::Value Next(const Napi::CallbackInfo& info);
  Napi::Value NextBatch(const Napi::CallbackInfo& info);
  Napi::Value Cursor(const Napi::CallbackInfo& info);
  Napi::Value CommittedSize(const Napi::CallbackInfo& info);
  void Seek(const Napi::CallbackInfo& info);
  void Close(const Napi::CallbackInfo& info);

  BatchOptions ParseOptions(Napi::Env env, const Napi::Object& value) const;
  BatchResult CollectFrames(Napi::Env env, const BatchOptions& options);
  void EnsureOpen(Napi::Env env) const;
  void EnsureCursorInBounds(Napi::Env env, uint64_t cursorSnapshot, uint64_t committedSnapshot) const;
  [[noreturn]] void ThrowWithCode(Napi::Env env, const std::string& message, const std::string& code) const;
  uint64_t LoadCommittedSize() const;
  static uint64_t ReadUint64LE(const uint8_t* data);
  static uint16_t ReadUint16LE(const uint8_t* data);

  bool closed_ { false };
  uint8_t* base_ { nullptr };
  size_t mappingLength_ { 0 };
  uint64_t headerSize_ { 0 };
  uint64_t dataOffset_ { 0 };
  uint64_t cursor_ { 0 };
  std::atomic<uint64_t>* committedSizeAtomic_ { nullptr };
  Napi::Reference<Napi::Buffer<uint8_t>> baseBufferRef_;
  Napi::Reference<Napi::Object> mappingRef_;
  ShmMapping* mapping_ { nullptr };
};
