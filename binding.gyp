{
  "variables": {
    "cflags_cc": [
      "-Wall",
      "-Werror",
      "-O3",
      "-fexceptions", # for boost
      "-frtti",       # for boost
      "-Wno-cast-function-type" # Node 12 problem with nan.h
    ]
  },

  "targets": [
	  {
        "target_name": "mmap",
        "sources": [ "./addons/mmap.cpp" ],
        "cflags_cc": [ "<@(cflags_cc)" ],
        "include_dirs" : ["<!(node -e \"require('nan')\")"],
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

