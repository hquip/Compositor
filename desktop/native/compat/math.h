#ifndef COMPOSITOR_MATH_H
#define COMPOSITOR_MATH_H
#define M_PI 3.14159265358979323846
#define INFINITY (__builtin_inff())
#define NAN (__builtin_nanf(""))
#define isfinite(x) __builtin_isfinite(x)
#define isnan(x) __builtin_isnan(x)
double pow(double, double), sqrt(double), exp(double), log(double), log2(double), exp2(double);
double cos(double), sin(double), tan(double), atan2(double, double), acos(double), asin(double), atan(double);
double tanh(double);
double floor(double), ceil(double), round(double), trunc(double), fabs(double), fmod(double, double), hypot(double, double);
double fmin(double, double), fmax(double, double);
float powf(float, float), sqrtf(float), expf(float), logf(float), log2f(float), exp2f(float);
float cosf(float), sinf(float), tanf(float), floorf(float), ceilf(float), roundf(float), fabsf(float), fmodf(float, float);
float fminf(float, float), fmaxf(float, float);
long lround(double), lroundf(float);
#endif
