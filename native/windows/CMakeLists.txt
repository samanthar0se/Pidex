cmake_minimum_required(VERSION 4.3.3)
project(pidex_windows_native LANGUAGES CXX)

if(NOT CMAKE_VERSION VERSION_EQUAL "4.3.3")
  message(FATAL_ERROR "Pidex candidate requires exact CMake 4.3.3")
endif()

if(NOT MSVC OR NOT CMAKE_CXX_COMPILER_VERSION VERSION_EQUAL "19.44.35207")
  message(FATAL_ERROR "Pidex candidate requires exact MSVC 19.44.35207")
endif()

if(NOT CMAKE_VS_WINDOWS_TARGET_PLATFORM_VERSION STREQUAL "10.0.26100.0")
  message(FATAL_ERROR "Pidex candidate requires Windows SDK 10.0.26100.0")
endif()

if(NOT CMAKE_SIZEOF_VOID_P EQUAL 8 OR NOT CMAKE_GENERATOR_PLATFORM STREQUAL "x64")
  message(
    FATAL_ERROR
    "Pidex native artifacts require an explicit x64 generator platform"
  )
endif()

add_subdirectory(common)
add_subdirectory(addon)
