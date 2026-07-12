#include "RealtimeSafetyProbe.h"

#include <array>
#include <cerrno>
#include <cstdarg>
#include <cstdio>
#include <cstdlib>
#include <dlfcn.h>
#include <fcntl.h>
#include <new>
#include <pthread.h>
#include <unistd.h>

namespace
{
    using beat::test::RealtimeViolation;
    using beat::test::RealtimeViolationKind;

    constexpr size_t maxViolations = 128;
    thread_local bool probeEnabled = false;
    thread_local size_t violationCount = 0;
    thread_local std::array<RealtimeViolation, maxViolations> violations {};

    using MutexLockFn = int (*)(pthread_mutex_t*);
    using MutexTryLockFn = int (*)(pthread_mutex_t*);
    using OpenFn = int (*)(const char*, int, ...);
    using OpenAtFn = int (*)(int, const char*, int, ...);
    using FOpenFn = FILE* (*)(const char*, const char*);
    using ReadFn = ssize_t (*)(int, void*, size_t);
    using WriteFn = ssize_t (*)(int, const void*, size_t);
    using FReadFn = size_t (*)(void*, size_t, size_t, FILE*);
    using FWriteFn = size_t (*)(const void*, size_t, size_t, FILE*);

    MutexLockFn realMutexLock = nullptr;
    MutexTryLockFn realMutexTryLock = nullptr;
    OpenFn realOpen = nullptr;
    OpenAtFn realOpenAt = nullptr;
    FOpenFn realFOpen = nullptr;
    ReadFn realRead = nullptr;
    WriteFn realWrite = nullptr;
    FReadFn realFRead = nullptr;
    FWriteFn realFWrite = nullptr;
    thread_local bool resolvingSymbols = false;

    template <typename Function>
    Function resolveNext(const char* name) noexcept
    {
        if (resolvingSymbols)
            return nullptr;
        resolvingSymbols = true;
        auto result = reinterpret_cast<Function>(dlsym(RTLD_NEXT, name));
        resolvingSymbols = false;
        return result;
    }

    void record(RealtimeViolationKind kind, void* callsite) noexcept
    {
        if (!probeEnabled)
            return;
        if (violationCount < violations.size())
            violations[violationCount] = { kind, callsite };
        ++violationCount;
    }

    void* allocate(size_t size, void* callsite)
    {
        record(RealtimeViolationKind::heapAllocation, callsite);
        if (void* memory = std::malloc(size == 0 ? 1 : size))
            return memory;
        throw std::bad_alloc();
    }

    void* allocateAligned(size_t size, size_t alignment, void* callsite)
    {
        record(RealtimeViolationKind::heapAllocation, callsite);
        void* memory = nullptr;
        if (posix_memalign(&memory, alignment, size == 0 ? alignment : size) == 0)
            return memory;
        throw std::bad_alloc();
    }

    mode_t requestedMode(int flags, va_list args) noexcept
    {
        return (flags & O_CREAT) != 0 ? static_cast<mode_t>(va_arg(args, int)) : 0;
    }
}

void* operator new(size_t size) { return allocate(size, __builtin_return_address(0)); }
void* operator new[](size_t size) { return allocate(size, __builtin_return_address(0)); }
void* operator new(size_t size, const std::nothrow_t&) noexcept { try { return allocate(size, __builtin_return_address(0)); } catch (...) { return nullptr; } }
void* operator new[](size_t size, const std::nothrow_t&) noexcept { try { return allocate(size, __builtin_return_address(0)); } catch (...) { return nullptr; } }
void* operator new(size_t size, std::align_val_t alignment) { return allocateAligned(size, (size_t) alignment, __builtin_return_address(0)); }
void* operator new[](size_t size, std::align_val_t alignment) { return allocateAligned(size, (size_t) alignment, __builtin_return_address(0)); }
void* operator new(size_t size, std::align_val_t alignment, const std::nothrow_t&) noexcept { try { return allocateAligned(size, (size_t) alignment, __builtin_return_address(0)); } catch (...) { return nullptr; } }
void* operator new[](size_t size, std::align_val_t alignment, const std::nothrow_t&) noexcept { try { return allocateAligned(size, (size_t) alignment, __builtin_return_address(0)); } catch (...) { return nullptr; } }
void operator delete(void* memory) noexcept { std::free(memory); }
void operator delete[](void* memory) noexcept { std::free(memory); }
void operator delete(void* memory, size_t) noexcept { std::free(memory); }
void operator delete[](void* memory, size_t) noexcept { std::free(memory); }
void operator delete(void* memory, std::align_val_t) noexcept { std::free(memory); }
void operator delete[](void* memory, std::align_val_t) noexcept { std::free(memory); }
void operator delete(void* memory, size_t, std::align_val_t) noexcept { std::free(memory); }
void operator delete[](void* memory, size_t, std::align_val_t) noexcept { std::free(memory); }

extern "C" int pthread_mutex_lock(pthread_mutex_t* mutex)
{
    if (realMutexLock == nullptr) realMutexLock = resolveNext<MutexLockFn>("pthread_mutex_lock");
    if (realMutexTryLock == nullptr) realMutexTryLock = resolveNext<MutexTryLockFn>("pthread_mutex_trylock");
    if (probeEnabled && realMutexTryLock != nullptr)
    {
        const int attempt = realMutexTryLock(mutex);
        if (attempt == 0)
            return 0;
        if (attempt == EBUSY)
            record(RealtimeViolationKind::blockingLock, __builtin_return_address(0));
    }
    return realMutexLock != nullptr ? realMutexLock(mutex) : EINVAL;
}

extern "C" int open(const char* path, int flags, ...)
{
    if (realOpen == nullptr) realOpen = resolveNext<OpenFn>("open");
    record(RealtimeViolationKind::fileOperation, __builtin_return_address(0));
    va_list args;
    va_start(args, flags);
    const mode_t mode = requestedMode(flags, args);
    va_end(args);
    return (flags & O_CREAT) != 0 ? realOpen(path, flags, mode) : realOpen(path, flags);
}

extern "C" int openat(int directory, const char* path, int flags, ...)
{
    if (realOpenAt == nullptr) realOpenAt = resolveNext<OpenAtFn>("openat");
    record(RealtimeViolationKind::fileOperation, __builtin_return_address(0));
    va_list args;
    va_start(args, flags);
    const mode_t mode = requestedMode(flags, args);
    va_end(args);
    return (flags & O_CREAT) != 0 ? realOpenAt(directory, path, flags, mode) : realOpenAt(directory, path, flags);
}

extern "C" FILE* fopen(const char* path, const char* mode)
{
    if (realFOpen == nullptr) realFOpen = resolveNext<FOpenFn>("fopen");
    record(RealtimeViolationKind::fileOperation, __builtin_return_address(0));
    return realFOpen(path, mode);
}

extern "C" ssize_t read(int fd, void* buffer, size_t size)
{
    if (realRead == nullptr) realRead = resolveNext<ReadFn>("read");
    record(RealtimeViolationKind::fileOperation, __builtin_return_address(0));
    return realRead(fd, buffer, size);
}

extern "C" ssize_t write(int fd, const void* buffer, size_t size)
{
    if (realWrite == nullptr) realWrite = resolveNext<WriteFn>("write");
    record(RealtimeViolationKind::fileOperation, __builtin_return_address(0));
    return realWrite(fd, buffer, size);
}

extern "C" size_t fread(void* buffer, size_t size, size_t count, FILE* stream)
{
    if (realFRead == nullptr) realFRead = resolveNext<FReadFn>("fread");
    record(RealtimeViolationKind::fileOperation, __builtin_return_address(0));
    return realFRead(buffer, size, count, stream);
}

extern "C" size_t fwrite(const void* buffer, size_t size, size_t count, FILE* stream)
{
    if (realFWrite == nullptr) realFWrite = resolveNext<FWriteFn>("fwrite");
    record(RealtimeViolationKind::fileOperation, __builtin_return_address(0));
    return realFWrite(buffer, size, count, stream);
}

namespace beat::test
{
    void prepareRealtimeSafetyInterposers() noexcept
    {
        if (realMutexLock == nullptr) realMutexLock = resolveNext<MutexLockFn>("pthread_mutex_lock");
        if (realMutexTryLock == nullptr) realMutexTryLock = resolveNext<MutexTryLockFn>("pthread_mutex_trylock");
        if (realOpen == nullptr) realOpen = resolveNext<OpenFn>("open");
        if (realOpenAt == nullptr) realOpenAt = resolveNext<OpenAtFn>("openat");
        if (realFOpen == nullptr) realFOpen = resolveNext<FOpenFn>("fopen");
        if (realRead == nullptr) realRead = resolveNext<ReadFn>("read");
        if (realWrite == nullptr) realWrite = resolveNext<WriteFn>("write");
        if (realFRead == nullptr) realFRead = resolveNext<FReadFn>("fread");
        if (realFWrite == nullptr) realFWrite = resolveNext<FWriteFn>("fwrite");
    }

    void beginRealtimeSafetyProbe() noexcept
    {
        violationCount = 0;
        violations.fill({});
        probeEnabled = true;
    }

    size_t endRealtimeSafetyProbe() noexcept
    {
        probeEnabled = false;
        return violationCount;
    }

    RealtimeViolation realtimeSafetyViolation(size_t index) noexcept
    {
        return index < violations.size() ? violations[index] : RealtimeViolation {};
    }

    void reportRealtimeSafetyViolation(RealtimeViolationKind kind, void* callsite) noexcept
    {
        record(kind, callsite);
    }

    bool realtimeSafetyProbeActive() noexcept { return probeEnabled; }
}
