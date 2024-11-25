#include <errno.h>
#include <iostream>
#include <sys/mman.h>
#include <napi.h>
#include <uv.h>
using namespace Napi;

/**
 * Make a shared memory object or file mapping and expose it to JS as Buffer
 * The memory pages will be overlapping by 2048
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

  char* buf = (char*) mmap(0, size * num, protection, flags, fd, 0);

  if (buf == MAP_FAILED) {
    std::cout << "mapping failed, errno: " << errno << "\n";
    std::cout << "http://man7.org/linux/man-pages/man2/mmap.2.html#ERRORS\n";
    return Napi::Number::New(env, 0);
  }

  Napi::Array nodeBuffersArray = Napi::Array::New(env, num);
  for (size_t i = 0; i < num; i++) {
    nodeBuffersArray.Set(
      i,
      Napi::Buffer<char>::New(env, buf + i * size, size + overlap)
    );
  }

  return nodeBuffersArray;
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set(Napi::String::New(env, "setup"),
    Napi::Function::New(env, setup)
  );

  return exports;
}

NODE_API_MODULE(NODE_GYP_MODULE_NAME, Init)
