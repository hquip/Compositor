#include <stdint.h>
#include <math.h>
#include <string.h>

static float falloff(float x, float y, float rx, float ry, float hardness) {
    float u = sqrtf(x*x/(rx*rx) + y*y/(ry*ry));
    if (u >= 1) return 0;
    if (u <= hardness) return 1;
    float t = (1-u)/(1-hardness); return t*t*(3-2*t);
}
static float sample(const float *data, int w, int h, float x, float y, int channel, int channels) {
    x = fminf(w-1, fmaxf(0,x)); y = fminf(h-1, fmaxf(0,y));
    int x0=(int)x, y0=(int)y, x1=x0+1<w?x0+1:x0, y1=y0+1<h?y0+1:y0;
    float fx=x-x0, fy=y-y0;
    float top=data[(y0*w+x0)*channels+channel]*(1-fx)+data[(y0*w+x1)*channels+channel]*fx;
    float bottom=data[(y1*w+x0)*channels+channel]*(1-fx)+data[(y1*w+x1)*channels+channel]*fx;
    return top*(1-fy)+bottom*fy;
}
void portable_pickup(const uint8_t *pixels, float *carried, int width, int height, int cx, int cy, int rx, int ry) {
    int side=2*rx+1;
    for(int dy=-ry;dy<=ry;dy++) for(int dx=-rx;dx<=rx;dx++) {
        int x=cx+dx,y=cy+dy,c=((dy+ry)*side+dx+rx)*4;
        for(int k=0;k<4;k++) carried[c+k]=(x>=0&&y>=0&&x<width&&y<height)?pixels[(y*width+x)*4+k]:0;
    }
}
void portable_smudge(uint8_t *pixels, float *carried, int width, int height, int cx, int cy, int rx, int ry,
                     float radiusX, float radiusY, float hardness, float strength) {
    int side=2*rx+1;
    for(int dy=-ry;dy<=ry;dy++) for(int dx=-rx;dx<=rx;dx++) {
        int x=cx+dx,y=cy+dy; if(x<0||y<0||x>=width||y>=height)continue;
        float weight=falloff(dx,dy,radiusX,radiusY,hardness)*strength; if(weight<=0)continue;
        int p=(y*width+x)*4,c=((dy+ry)*side+dx+rx)*4;
        for(int k=0;k<4;k++){float value=pixels[p+k]+(carried[c+k]-pixels[p+k])*weight;pixels[p+k]=(uint8_t)fminf(255,fmaxf(0,roundf(value)));carried[c+k]=value;}
    }
}
void portable_liquify(const uint8_t *original, uint8_t *pixels, float *offsets, float *scratch, int width, int height,
                      int cx, int cy, float radiusX, float radiusY, float hardness, float strength, float dx, float dy) {
    int rx=(int)ceilf(radiusX),ry=(int)ceilf(radiusY),margin=(int)ceilf(fmaxf(fabsf(dx),fabsf(dy))*strength)+2;
    int x0=cx-rx-margin>0?cx-rx-margin:0,y0=cy-ry-margin>0?cy-ry-margin:0;
    int x1=cx+rx+margin<width?cx+rx+margin:width-1,y1=cy+ry+margin<height?cy+ry+margin:height-1;
    if(x0>x1||y0>y1)return; int w=x1-x0+1,h=y1-y0+1;
    for(int y=0;y<h;y++)memcpy(scratch+y*w*2,offsets+((y+y0)*width+x0)*2,w*2*sizeof(float));
    for(int y=cy-ry;y<=cy+ry;y++)for(int x=cx-rx;x<=cx+rx;x++){
        if(x<x0||y<y0||x>x1||y>y1)continue;
        float weight=falloff(x-cx,y-cy,radiusX,radiusY,hardness)*strength;if(weight<=0)continue;
        float ox=sample(scratch,w,h,x-x0-dx*weight,y-y0-dy*weight,0,2)-dx*weight;
        float oy=sample(scratch,w,h,x-x0-dx*weight,y-y0-dy*weight,1,2)-dy*weight;
        offsets[(y*width+x)*2]=ox;offsets[(y*width+x)*2+1]=oy;
        float sx=fminf(width-1,fmaxf(0,x+ox)),sy=fminf(height-1,fmaxf(0,y+oy));
        int ax=(int)sx,ay=(int)sy,bx=ax+1<width?ax+1:ax,by=ay+1<height?ay+1:ay;float fx=sx-ax,fy=sy-ay;
        for(int k=0;k<4;k++){float top=original[(ay*width+ax)*4+k]*(1-fx)+original[(ay*width+bx)*4+k]*fx;float bottom=original[(by*width+ax)*4+k]*(1-fx)+original[(by*width+bx)*4+k]*fx;pixels[(y*width+x)*4+k]=(uint8_t)fminf(255,fmaxf(0,roundf(top*(1-fy)+bottom*fy)));}
    }
}
