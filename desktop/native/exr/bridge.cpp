#include <ImfMultiPartInputFile.h>
#include <ImfMultiPartOutputFile.h>
#include <ImfInputPart.h>
#include <ImfOutputPart.h>
#include <ImfTiledInputPart.h>
#include <ImfTiledOutputPart.h>
#include <ImfDeepScanLineInputPart.h>
#include <ImfDeepTiledInputPart.h>
#include <ImfDeepFrameBuffer.h>
#include <ImfHeader.h>
#include <ImfChannelList.h>
#include <ImfFrameBuffer.h>
#include <ImfIO.h>
#include <ImfPartType.h>
#include <ImfStandardAttributes.h>
#include <ImfStringAttribute.h>
#include <ImfOutputFile.h>
#include <ImfTiledOutputFile.h>
#include <algorithm>
#include <array>
#include <cmath>
#include <cstring>
#include <memory>
#include <numeric>
#include <stdexcept>
#include <string>
#include <vector>

namespace exr = OPENEXR_IMF_NAMESPACE;
namespace math = IMATH_NAMESPACE;
constexpr size_t fileLimit = 256 * 1024 * 1024;
static void require(bool value, const char* message) { if (!value) throw std::runtime_error(message); }
class MemoryInput final : public exr::IStream {
    const char* data; size_t length; uint64_t position = 0;
public:
    MemoryInput(const char* bytes, size_t size) : IStream("embedded.exr"), data(bytes), length(size) {}
    bool read(char* target, int size) override { require(size >= 0 && position <= length && size_t(size) <= length - position, "Truncated OpenEXR stream."); std::memcpy(target, data + position, size); position += size; return position < length; }
    uint64_t tellg() override { return position; }
    void seekg(uint64_t at) override { require(at <= length, "Invalid OpenEXR stream offset."); position = at; }
    int64_t size() override { return int64_t(length); }
};
class MemoryOutput final : public exr::OStream {
    uint64_t position = 0;
public:
    std::vector<char> bytes;
    MemoryOutput() : OStream("output.exr") {}
    void write(const char* source, int length) override { require(length >= 0 && position + size_t(length) <= fileLimit, "OpenEXR export exceeds the supported file size."); if (position + length > bytes.size()) bytes.resize(position + length); std::memcpy(bytes.data() + position, source, length); position += length; }
    uint64_t tellp() override { return position; }
    void seekp(uint64_t at) override { require(at <= fileLimit, "Invalid OpenEXR output offset."); position = at; }
};
static std::unique_ptr<MemoryInput> input;
static std::unique_ptr<exr::MultiPartInputFile> file;
static std::string error;
static std::vector<float> result;
static int resultWidth = 0, resultHeight = 0, sampleTotal = 0, pixelLimit = 16000000, sampleLimit = 8000000;
static char* biased(void* pointer, const math::Box2i& window, size_t stride, int width) {
    return reinterpret_cast<char*>(intptr_t(pointer) - intptr_t(window.min.x) * stride - intptr_t(window.min.y) * stride * width);
}
static void checkWindow(const math::Box2i& window, int limit) {
    const int64_t width = int64_t(window.max.x) - window.min.x + 1, height = int64_t(window.max.y) - window.min.y + 1;
    require(width > 0 && height > 0 && width <= 30000 && height <= 30000 && width * height <= limit, "OpenEXR dimensions exceed the supported pixel budget.");
}
extern "C" {
const char* exr_error() { return error.c_str(); }
int exr_open(const char* bytes, int length, int limit, int samples) {
    try {
        error.clear(); file.reset(); input.reset(); require(length > 0 && size_t(length) <= fileLimit && limit > 0 && limit <= 16000000 && samples > 0 && samples <= 8000000, "Invalid OpenEXR limits."); pixelLimit = limit; sampleLimit = samples;
        exr::Header::setMaxImageSize(30000, 30000); exr::Header::setMaxTileSize(1024, 1024);
        input = std::make_unique<MemoryInput>(bytes, length); file = std::make_unique<exr::MultiPartInputFile>(*input, 0, false);
        require(file->parts() > 0 && file->parts() <= 64, "OpenEXR has too many parts.");
        for (int i = 0; i < file->parts(); i++) { const auto& h = file->header(i); checkWindow(h.dataWindow(), limit); checkWindow(h.displayWindow(), limit); }
        return 1;
    } catch (const std::exception& e) { error = e.what(); file.reset(); input.reset(); return 0; }
}
void exr_close() { file.reset(); input.reset(); result.clear(); result.shrink_to_fit(); }
int exr_width() { return resultWidth; }
int exr_height() { return resultHeight; }
int exr_samples() { return sampleTotal; }
float* exr_decode(int part, const char* group, int lx, int ly, double nearDepth, double farDepth) {
    try {
        require(file && part >= 0 && part < file->parts() && lx >= 0 && ly >= 0 && nearDepth <= farDepth, "Invalid OpenEXR part or level.");
        const auto& header = file->header(part); const auto& channels = header.channels(); const std::string prefix = group && *group ? std::string(group) + "." : "";
        const bool rgb = channels.findChannel((prefix + "R").c_str()) && channels.findChannel((prefix + "G").c_str()) && channels.findChannel((prefix + "B").c_str());
        require(rgb || channels.findChannel((prefix + "Y").c_str()), "OpenEXR requires RGB or grayscale Y channels.");
        const bool deep = header.type() == exr::DEEPSCANLINE || header.type() == exr::DEEPTILE, tiled = header.type() == exr::TILEDIMAGE || header.type() == exr::DEEPTILE;
        math::Box2i window = header.dataWindow();
        if (tiled) { if (deep) { exr::DeepTiledInputPart p(*file, part); require(p.isValidLevel(lx, ly), "Invalid OpenEXR tile level."); window = p.dataWindowForLevel(lx, ly); } else { exr::TiledInputPart p(*file, part); require(p.isValidLevel(lx, ly), "Invalid OpenEXR tile level."); window = p.dataWindowForLevel(lx, ly); } }
        else require(lx == 0 && ly == 0, "Scanline OpenEXR has only level zero.");
        checkWindow(window, deep ? std::min(pixelLimit, 4000000) : pixelLimit); resultWidth = window.max.x - window.min.x + 1; resultHeight = window.max.y - window.min.y + 1;
        const size_t pixels = size_t(resultWidth) * resultHeight; result.assign(pixels * 4, 0); sampleTotal = 0;
        std::array<std::string, 4> names = { prefix + (rgb ? "R" : "Y"), prefix + (rgb ? "G" : "Y"), prefix + (rgb ? "B" : "Y"), prefix + "A" };
        if (deep && !channels.findChannel(names[3].c_str())) names[3] = "A";
        for (const auto& name : names) { const auto* channel = channels.findChannel(name.c_str()); if (channel) require(channel->type != exr::UINT && channel->xSampling == 1 && channel->ySampling == 1, "OpenEXR color channels require full-resolution HALF or FLOAT samples."); }
        if (!deep) {
            exr::FrameBuffer buffer;
            for (int c = 0; c < 4; c++) { const bool duplicate = !rgb && c > 0 && c < 3; if (!duplicate) buffer.insert(names[c], exr::Slice::Make(exr::FLOAT, result.data() + c, window, 4 * sizeof(float), resultWidth * 4 * sizeof(float), 1, 1, c == 3 ? 1 : 0)); }
            if (tiled) { exr::TiledInputPart p(*file, part); p.setFrameBuffer(buffer); p.readTiles(0, p.numXTiles(lx) - 1, 0, p.numYTiles(ly) - 1, lx, ly); }
            else { exr::InputPart p(*file, part); p.setFrameBuffer(buffer); p.readPixels(window.min.y, window.max.y); }
            if (!rgb) for (size_t i = 0; i < pixels; i++) result[i * 4 + 1] = result[i * 4 + 2] = result[i * 4];
        } else {
            const std::string z = channels.findChannel((prefix + "Z").c_str()) ? prefix + "Z" : "Z", zBack = channels.findChannel((prefix + "ZBack").c_str()) ? prefix + "ZBack" : "ZBack";
            require(channels.findChannel(z.c_str()) && channels.findChannel(names[3].c_str()), "Deep preview requires Z and A channels.");
            std::vector<unsigned> counts(pixels); exr::DeepFrameBuffer buffer; buffer.insertSampleCountSlice(exr::Slice::Make(exr::UINT, counts.data(), window));
            std::unique_ptr<exr::DeepScanLineInputPart> scan; std::unique_ptr<exr::DeepTiledInputPart> tiles;
            if (tiled) { tiles = std::make_unique<exr::DeepTiledInputPart>(*file, part); tiles->setFrameBuffer(buffer); tiles->readPixelSampleCounts(0, tiles->numXTiles(lx) - 1, 0, tiles->numYTiles(ly) - 1, lx, ly); }
            else { scan = std::make_unique<exr::DeepScanLineInputPart>(*file, part); scan->setFrameBuffer(buffer); scan->readPixelSampleCounts(window.min.y, window.max.y); }
            size_t total = 0; for (unsigned count : counts) { require(count <= 4096 && total + count <= size_t(sampleLimit), "Deep samples exceed the supported memory budget."); total += count; } sampleTotal = int(total);
            std::array<std::string, 6> deepNames = { names[0], names[1], names[2], names[3], z, channels.findChannel(zBack.c_str()) ? zBack : z };
            std::array<std::vector<float>, 6> values; std::array<std::vector<float*>, 6> pointers;
            for (int c = 0; c < 6; c++) {
                values[c].assign(total, c == 3 ? 1 : 0); pointers[c].resize(pixels); size_t offset = 0;
                for (size_t i = 0; i < pixels; i++) { pointers[c][i] = total ? values[c].data() + offset : nullptr; offset += counts[i]; }
                if ((!rgb && c > 0 && c < 3) || (c == 5 && deepNames[5] == z)) continue;
                buffer.insert(deepNames[c], exr::DeepSlice(exr::FLOAT, biased(pointers[c].data(), window, sizeof(float*), resultWidth), sizeof(float*), resultWidth * sizeof(float*), sizeof(float), 1, 1, c == 3 ? 1 : 0));
            }
            if (tiled) { tiles->setFrameBuffer(buffer); tiles->readTiles(0, tiles->numXTiles(lx) - 1, 0, tiles->numYTiles(ly) - 1, lx, ly); }
            else { scan->setFrameBuffer(buffer); scan->readPixels(window.min.y, window.max.y); }
            size_t offset = 0; std::vector<unsigned> order;
            for (size_t i = 0; i < pixels; i++) {
                order.resize(counts[i]); std::iota(order.begin(), order.end(), 0);
                for (unsigned n : order) { require(!std::isnan(values[4][offset + n]), "Invalid deep sample depth."); for (int c = 0; c < 4; c++) require(std::isfinite(values[c][offset + n]) && (c == 3 ? values[c][offset + n] >= 0 && values[c][offset + n] <= 1 : std::abs(values[c][offset + n]) <= 1000000), "Invalid deep sample range."); }
                std::stable_sort(order.begin(), order.end(), [&](unsigned a, unsigned b) { return values[4][offset + a] < values[4][offset + b]; });
                double alpha = 0, colors[3] = {0, 0, 0};
                for (unsigned n : order) { const size_t at = offset + n; if (values[4][at] < nearDepth || values[4][at] > farDepth) continue; for (int c = 0; c < 3; c++) colors[c] += values[rgb ? c : 0][at] * (1 - alpha); alpha += values[3][at] * (1 - alpha); }
                for (int c = 0; c < 3; c++) result[i * 4 + c] = float(colors[c]); result[i * 4 + 3] = float(alpha); offset += counts[i];
            }
        }
        return result.data();
    } catch (const std::exception& e) { error = e.what(); result.clear(); return nullptr; }
}
}

struct OutputFrame { std::string name; int width, height; std::vector<float> data; };
static std::vector<OutputFrame> frames;
static std::unique_ptr<MemoryOutput> output;
extern "C" {
void exr_output_begin() { frames.clear(); output.reset(); error.clear(); }
int exr_output_add(const char* name, const float* pixels, int width, int height) {
    try { require(frames.size() < 64 && width > 0 && height > 0 && int64_t(width) * height <= pixelLimit, "Invalid OpenEXR output part."); size_t total = size_t(width) * height; for (const auto& frame : frames) total += size_t(frame.width) * frame.height; require(total <= 16000000, "Multipart export exceeds the pixel budget."); frames.push_back({name, width, height, std::vector<float>(pixels, pixels + size_t(width) * height * 4)}); return 1; }
    catch (const std::exception& e) { error = e.what(); return 0; }
}
const char* exr_output_finish(int bits, int compression, int tileSize, const float* chromaticities, const char* colorID) {
    try {
        require(!frames.empty() && (bits == 16 || bits == 32) && compression >= 0 && compression <= 9 && (tileSize == 0 || tileSize >= 16 && tileSize <= 1024), "Invalid OpenEXR export options.");
        output = std::make_unique<MemoryOutput>(); std::vector<exr::Header> headers;
        for (size_t i = 0; i < frames.size(); i++) { const auto& frame = frames[i]; exr::Header header(frame.width, frame.height); header.compression() = exr::Compression(compression); for (const char* name : {"R", "G", "B", "A"}) header.channels().insert(name, exr::Channel(bits == 16 ? exr::HALF : exr::FLOAT)); header.setName(std::to_string(i + 1) + " " + frame.name); header.setType(tileSize ? exr::TILEDIMAGE : exr::SCANLINEIMAGE); if (tileSize) header.setTileDescription(exr::TileDescription(tileSize, tileSize)); exr::addChromaticities(header, exr::Chromaticities(math::V2f(chromaticities[0], chromaticities[1]), math::V2f(chromaticities[2], chromaticities[3]), math::V2f(chromaticities[4], chromaticities[5]), math::V2f(chromaticities[6], chromaticities[7]))); header.insert("colorInteropID", exr::StringAttribute(colorID)); headers.push_back(header); }
        std::unique_ptr<exr::MultiPartOutputFile> multipart; if (frames.size() > 1) multipart = std::make_unique<exr::MultiPartOutputFile>(*output, headers.data(), int(headers.size()));
        for (size_t i = 0; i < frames.size(); i++) {
            auto& frame = frames[i]; exr::FrameBuffer buffer; std::vector<math::half> halves;
            if (bits == 16) { halves.reserve(frame.data.size()); for (float value : frame.data) { require(std::isfinite(value) && std::abs(value) <= 65504, "Half-float EXR exceeds its range."); halves.emplace_back(value); } }
            for (int c = 0; c < 4; c++) buffer.insert(std::array<const char*, 4>{"R", "G", "B", "A"}[c], exr::Slice(bits == 16 ? exr::HALF : exr::FLOAT, bits == 16 ? reinterpret_cast<char*>(halves.data() + c) : reinterpret_cast<char*>(frame.data.data() + c), bits / 8 * 4, frame.width * bits / 8 * 4));
            if (multipart) { if (tileSize) { exr::TiledOutputPart part(*multipart, int(i)); part.setFrameBuffer(buffer); part.writeTiles(0, part.numXTiles() - 1, 0, part.numYTiles() - 1); } else { exr::OutputPart part(*multipart, int(i)); part.setFrameBuffer(buffer); part.writePixels(frame.height); } }
            else if (tileSize) { exr::TiledOutputFile part(*output, headers[i]); part.setFrameBuffer(buffer); part.writeTiles(0, part.numXTiles() - 1, 0, part.numYTiles() - 1); }
            else { exr::OutputFile part(*output, headers[i]); part.setFrameBuffer(buffer); part.writePixels(frame.height); }
        }
        multipart.reset(); frames.clear(); return output->bytes.data();
    } catch (const std::exception& e) { error = e.what(); output.reset(); frames.clear(); return nullptr; }
}
int exr_output_size() { return output ? int(output->bytes.size()) : 0; }
}
