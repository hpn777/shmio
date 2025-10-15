#include <errno.h>
#include <iostream>
#include <cstring>
#include <sys/mman.h>
#include <napi.h>
#include <uv.h>
#include "shm_iterator.h"
#include "shm_mapping.h"
#include "shm_writer.h"
using namespace Napi;

/**
 * Make a shared memory object or file mapping and expose it to JS as Buffer
 * The memory pages will be overlapping to allow reading data that spans buffer boundaries
 *
 * Memory layout:
 *   Buffer 0: [0, size + overlap)
 *   Buffer 1: [size, 2*size + overlap)
 *   ...
 *   Buffer N-1: [size*(N-1), size*N)  <- Last buffer has NO overlap to prevent out-of-bounds
 *
 * TODO: fix double free error on exit
 *       there is a node.AtExit but doesn't seem to work
 */

Napi::Value setup(const Napi::CallbackInfo& info) {
  
  Napi::Env env = info.Env();

  const size_t size = info[0].As<Napi::Number>().Uint32Value();
  const size_t num = info[1].As<Napi::Number>().Uint32Value();
  const size_t overlap = info[2].As<Napi::Number>().Uint32Value();
  const int protection = info[3].As<Napi::Number>().Uint32Value();
  const int flags = info[4].As<Napi::Number>().Uint32Value();
  const int fd = info[5].As<Napi::Number>().Uint32Value();

  // Allocate size*num (not size*num+overlap) to match file size
  char* buf = (char*) mmap(0, size * num, protection, flags, fd, 0);

  if (buf == MAP_FAILED) {
    Napi::Error::New(env, std::string("mmap failed: ") + strerror(errno) + 
                     " (see http://man7.org/linux/man-pages/man2/mmap.2.html#ERRORS)")
      .ThrowAsJavaScriptException();
    return env.Null();
  }

  Napi::Array nodeBuffersArray = Napi::Array::New(env, num);
  for (size_t i = 0; i < num; i++) {
    // Last buffer gets no overlap to prevent out-of-bounds access
    size_t buffer_size = (i == num - 1) ? size : size + overlap;
    nodeBuffersArray.Set(
      i,
      Napi::Buffer<char>::New(env, buf + i * size, buffer_size)
    );
  }

  return nodeBuffersArray;
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set(Napi::String::New(env, "setup"),
    Napi::Function::New(env, setup)
  );

  ShmIterator::Init(env, exports);
  ShmMapping::Init(env, exports);
  ShmWriter::Init(env, exports);

  return exports;
}

NODE_API_MODULE(NODE_GYP_MODULE_NAME, Init)
