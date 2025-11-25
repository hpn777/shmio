#pragma once

#include <napi.h>
#include <atomic>

class ShmMapping;

class ShmWriter : public Napi::ObjectWrap<ShmWriter> {
public:
  static void Init(Napi::Env env, Napi::Object exports);
  static Napi::FunctionReference constructor_;

  ShmWriter(const Napi::CallbackInfo& info);
  ~ShmWriter() override;

private:
  friend class ShmMapping;
  Napi::Value Allocate(const Napi::CallbackInfo& info);
  void Commit(const Napi::CallbackInfo& info);
  void Close(const Napi::CallbackInfo& info);
  Napi::Value GetLastAllocatedAddress(const Napi::CallbackInfo& info);
  Napi::Value GetBufferAtAddress(const Napi::CallbackInfo& info);

  void EnsureOpen(Napi::Env env) const;
  void WriteFrameHeaders(uint8_t* framePtr, uint32_t frameSize) const;
  static uint16_t ReadUint16LE(const uint8_t* data);
  static void WriteUint16LE(uint8_t* data, uint16_t value);

  ShmMapping* mapping_ { nullptr };
  Napi::Reference<Napi::Object> mappingRef_;
  bool closed_ { false };
  bool debugChecks_ { false };
  uint64_t cursor_ { 0 };
  uint64_t pendingBytes_ { 0 };
  uint64_t lastAllocatedOffset_ { 0 };
  uint32_t lastAllocatedPayloadSize_ { 0 };
};
