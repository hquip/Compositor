#include <ImfDeepTiledOutputFile.h>
#include <ImfDeepFrameBuffer.h>
#include <ImfHeader.h>
#include <ImfChannelList.h>
#include <ImfPartType.h>
#include <ImfStringAttribute.h>
#include <array>

int main() {
    namespace exr = OPENEXR_IMF_NAMESPACE;
    exr::Header header(2, 2); header.setType(exr::DEEPTILE); header.setTileDescription(exr::TileDescription(3, 4)); header.compression() = exr::ZIPS_COMPRESSION;
    header.insert("colorInteropID", exr::StringAttribute("lin_rec709_scene"));
    const std::array<const char*, 6> names = {"R", "G", "B", "A", "Z", "ZBack"};
    const float reference[6][2] = {{4,1}, {0,2}, {1,0}, {.5,.5}, {2,1}, {2,1}};
    unsigned counts[4] = {0, 2, 2, 2}; float values[6][4][2]; float* pointers[6][4]; exr::DeepFrameBuffer frame;
    frame.insertSampleCountSlice(exr::Slice(exr::UINT, reinterpret_cast<char*>(counts), sizeof(unsigned), 2 * sizeof(unsigned)));
    for (int c = 0; c < 6; c++) { header.channels().insert(names[c], exr::Channel(exr::FLOAT)); for (int i = 0; i < 4; i++) { values[c][i][0] = reference[c][0]; values[c][i][1] = reference[c][1]; pointers[c][i] = values[c][i]; } frame.insert(names[c], exr::DeepSlice(exr::FLOAT, reinterpret_cast<char*>(pointers[c]), sizeof(float*), 2 * sizeof(float*), sizeof(float))); }
    exr::DeepTiledOutputFile output("deep-tiled.exr", header); output.setFrameBuffer(frame); output.writeTile(0, 0); return 0;
}
