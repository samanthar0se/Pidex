if(NOT DEFINED PIDEX_NODE_INCLUDE_DIR)
  message(FATAL_ERROR "PIDEX_NODE_INCLUDE_DIR must select the hash-verified Node headers")
endif()
if(NOT DEFINED PIDEX_RELEASE_ID)
  message(FATAL_ERROR "PIDEX_RELEASE_ID must identify the selected closure")
endif()

add_library(pidex_windows MODULE src/addon.cpp)
target_include_directories(pidex_windows PRIVATE "${PIDEX_NODE_INCLUDE_DIR}")
target_compile_features(pidex_windows PRIVATE cxx_std_20)
target_compile_definitions(pidex_windows PRIVATE
  NAPI_VERSION=10
  PIDEX_RELEASE_ID="${PIDEX_RELEASE_ID}"
  PIDEX_ADDON_GENERATION=1
  PIDEX_SCHEMA_GENERATION=1
)
target_compile_options(pidex_windows PRIVATE /permissive- /W4 /WX /EHsc /utf-8 /guard:cf /sdl)
target_link_options(pidex_windows PRIVATE /WX /DYNAMICBASE /NXCOMPAT /CETCOMPAT)
set_target_properties(pidex_windows PROPERTIES
  PREFIX ""
  SUFFIX ".node"
  OUTPUT_NAME "pidex_windows"
  CXX_EXTENSIONS OFF
  MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>"
)
