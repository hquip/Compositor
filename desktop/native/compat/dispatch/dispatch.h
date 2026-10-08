#ifndef COMPOSITOR_DISPATCH_H
#define COMPOSITOR_DISPATCH_H
#include <stddef.h>
#define DISPATCH_APPLY_AUTO 0
/* Bands run in the current WASM invocation; callers can move complete jobs to a worker. */
static inline void dispatch_apply(size_t count, int queue, void (^body)(size_t)) {
    (void)queue;
    for (size_t i = 0; i < count; ++i) body(i);
}
#endif
