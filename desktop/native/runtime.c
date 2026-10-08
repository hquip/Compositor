#include <stddef.h>
#include <stdint.h>
#include <string.h>
extern unsigned char __heap_base;
static size_t next;
static int failed;
void *_NSConcreteStackBlock[32];
void *_NSConcreteGlobalBlock[32];
void arena_reset(void) { next = ((size_t)&__heap_base + 15) & ~(size_t)15; failed = 0; }
int arena_failed(void) { return failed; }
void *malloc(size_t count) {
    if (!next) arena_reset();
    if (count > 2147483616u - next) { failed = 1; return 0; }
    size_t end = (next + count + 31) & ~(size_t)15;
    size_t capacity = __builtin_wasm_memory_size(0) * 65536u;
    if (end > capacity && __builtin_wasm_memory_grow(0, (end - capacity + 65535) / 65536) == (size_t)-1) { failed = 1; return 0; }
    *(size_t *)next = count;
    void *result = (void *)(next + 16); next = end; return result;
}
void free(void *pointer) { (void)pointer; }
void *calloc(size_t count, size_t size) {
    if (size && count > 2147483647u / size) { failed = 1; return 0; }
    void *result = malloc(count * size); if (result) memset(result, 0, count * size); return result;
}
void *realloc(void *pointer, size_t count) {
    void *result = malloc(count);
    if (pointer && result) { size_t old = *(size_t *)((unsigned char *)pointer - 16); memcpy(result, pointer, old < count ? old : count); }
    return result;
}
void *memset(void *destination, int value, size_t count) {
    unsigned char *p = destination; for (size_t i = 0; i < count; ++i) p[i] = (unsigned char)value; return destination;
}
void *memcpy(void *destination, const void *source, size_t count) {
    unsigned char *a = destination; const unsigned char *b = source;
    for (size_t i = 0; i < count; ++i) a[i] = b[i]; return destination;
}
void *memmove(void *destination, const void *source, size_t count) {
    unsigned char *a = destination; const unsigned char *b = source;
    if (a <= b) return memcpy(destination, source, count);
    while (count) { --count; a[count] = b[count]; } return destination;
}
int memcmp(const void *a, const void *b, size_t count) {
    const unsigned char *p = a, *q = b;
    for (size_t i = 0; i < count; ++i) if (p[i] != q[i]) return (int)p[i] - q[i]; return 0;
}
void *_Block_copy(const void *block) { return (void *)block; }
void _Block_release(const void *block) { (void)block; }
