add_executable(pidex-launcher
  src/history.cpp
  src/local_control.cpp
  src/main.cpp
  src/supervision.cpp
)

target_link_libraries(pidex-launcher PRIVATE pidex_windows_common)
target_compile_features(pidex-launcher PRIVATE cxx_std_20)
set_target_properties(pidex-launcher PROPERTIES
  OUTPUT_NAME "pidex-launcher"
  CXX_EXTENSIONS OFF
  MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>"
)
target_compile_options(pidex-launcher PRIVATE
  /permissive- /W4 /WX /EHsc /utf-8 /guard:cf /sdl
)
target_link_options(pidex-launcher PRIVATE
  /WX /DYNAMICBASE /NXCOMPAT /CETCOMPAT
)
