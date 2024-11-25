{
  "variables": {
    "cflags_cc": [
      "-Wall",
      "-Werror",
      "-O3",
      "-fexceptions", # for boost
      "-frtti",       # for boost
      # "-Wno-cast-function-type" # Node 12 problem with nan.h
    ]
  },
  "targets": [
	  {
        "target_name": "mmap",
      "cflags!": [ "-fno-exceptions" ],
      "cflags_cc!": [ "-fno-exceptions" ],
      "xcode_settings": { "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
        "CLANG_CXX_LIBRARY": "libc++",
        "MACOSX_DEPLOYMENT_TARGET": "10.7",
      },
      "msvs_settings": {
        "VCCLCompilerTool": { "ExceptionHandling": 1 },
      },
        "sources": [ "./addons/mmap.cpp" ],
        "cflags_cc": [ "<@(cflags_cc)" ],
        "include_dirs" : [
          "<!(node -p \"require('node-addon-api').include\")",
          "node_modules/node-addon-api"
        ],
        "conditions": [
          [
            'OS == "mac"', {
              "xcode_settings": {
                "GCC_ENABLE_CPP_EXCEPTIONS": "YES"
              }
            }
          ]
        ]
    }
  ]
}

