add_library(pidex_windows_common STATIC
  src/error.cpp
  src/identity.cpp
)

target_include_directories(pidex_windows_common PUBLIC include)
target_compile_features(pidex_windows_common PUBLIC cxx_std_20)

set_target_properties(pidex_windows_common PROPERTIES
  CXX_EXTENSIONS OFF
  MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>"
)

target_compile_options(pidex_windows_common PRIVATE
  /permissive-
  /W4
  /WX
  /EHsc
  /utf-8
  /guard:cf
  /sdl
)

target_link_options(pidex_windows_common PUBLIC
  /WX
  /DYNAMICBASE
  /NXCOMPAT
  /CETCOMPAT
)

target_compile_definitions(pidex_windows_common PUBLIC
  UNICODE
  _UNICODE
  WIN32_LEAN_AND_MEAN
  NOMINMAX
)
