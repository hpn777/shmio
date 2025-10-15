#pragma once

#include <atomic>
#include <fcntl.h>
#include <napi.h>
#include <string>

class ShmIterator;
class ShmWriter;

class ShmMapping : public Napi::ObjectWrap<ShmMapping> {
public:
  static void Init(Napi::Env env, Napi::Object exports);
  static Napi::Value Open(const Napi::CallbackInfo& info);
  static Napi::FunctionReference constructor_;

  ShmMapping(const Napi::CallbackInfo& info);
  ~ShmMapping() override;

  uint8_t* base() const { return base_; }
  size_t length() const { return length_; }
  uint64_t headerSize() const { return headerSize_; }
  uint64_t dataOffset() const { return dataOffset_; }
  std::atomic<uint64_t>* committedSizeAtomic() const { return committedSizeAtomic_; }
  bool writable() const { return writable_; }
  bool debugChecks() const { return debugChecks_; }

  uint64_t LoadCommittedSize() const;
  void StoreCommittedSize(uint64_t value);

  void EnsureOpen(Napi::Env env) const;

private:
  Napi::Value HeaderView(const Napi::CallbackInfo& info);
  Napi::Value CreateIterator(const Napi::CallbackInfo& info);
  Napi::Value CreateWriter(const Napi::CallbackInfo& info);
  void Close(const Napi::CallbackInfo& info);

  void Cleanup();

  static uint64_t ReadUint64LE(const uint8_t* data);
  static void WriteUint64LE(uint8_t* data, uint64_t value);

  uint8_t* base_ { nullptr };
  size_t length_ { 0 };
  bool writable_ { false };
  bool debugChecks_ { false };
  bool closed_ { false };
  int fd_ { -1 };
  uint64_t headerSize_ { 0 };
  uint64_t dataOffset_ { 0 };
  std::atomic<uint64_t>* committedSizeAtomic_ { nullptr };
  Napi::Reference<Napi::Buffer<uint8_t>> mappingBufferRef_;
};
