#include <errno.h>
#include <iostream>
#include <sys/mman.h>
#include <nan.h>
#include <node.h>
using namespace Nan;
using namespace v8;

/**
 * Make a shared memory object or file mapping and expose it to JS as Buffer
 * The memory pages will be overlapping by 2048
 *
 * TODO: fix double free error on exit
 *       there is a node.AtExit but doesn't seem to work
 */

NAN_METHOD(setup) {

  Local<Context> context = Nan::GetCurrentContext();

  const size_t size = info[0]->Uint32Value(context).FromJust();
  const size_t num = info[1]->Uint32Value(context).FromJust();
  const size_t overlap = info[2]->Uint32Value(context).FromJust();
  const int protection = info[3]->Uint32Value(context).FromJust();
  const int flags = info[4]->Uint32Value(context).FromJust();
  const int fd = info[5]->Uint32Value(context).FromJust();

  char* buf = (char*) mmap(0, size * num, protection, flags, fd, 0);

  if (buf == MAP_FAILED) {
    std::cout << "mapping failed, errno: " << errno << "\n";
    std::cout << "http://man7.org/linux/man-pages/man2/mmap.2.html#ERRORS\n";
    return;
  }

  Local<Array> nodeBuffersArray = New<Array>(num);
  for (size_t i = 0; i < num; i++) {

    Nan::Set(
      nodeBuffersArray,
      i,
      Nan::NewBuffer(buf + i * size, size + overlap).ToLocalChecked()
    );
  }

  info.GetReturnValue().Set(nodeBuffersArray);
}

NAN_MODULE_INIT(Init) {
  Nan::Set(
    target,
    New<String>("setup").ToLocalChecked(),
    GetFunction(New<FunctionTemplate>(setup)).ToLocalChecked()
  );
}

NODE_MODULE(NODE_GYP_MODULE_NAME, Init)
