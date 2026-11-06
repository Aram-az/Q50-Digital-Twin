// Q50 Digital Twin Phase 2: synthetic CAN decoder (C++17 standard library).
//
// This is a project-specific TEST PROTOCOL, not actual Infiniti/Nissan CAN data.
// Do NOT transmit these IDs/frames onto a car's network.
//
// Input lines: timestamp_utc|elapsed_s|session_id|source|can_id|data_hex
// Every logical sample consists of exactly two consecutive frames, IDs 0x500
// and 0x501 (either order). Both contain an identical 16-bit sequence counter.
// Output: Phase 1-compatible JSONL telemetry. No external libraries needed.
#include <array>
#include <cmath>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <limits>
#include <regex>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

namespace fs = std::filesystem;

namespace {

constexpr unsigned int kMotion = 0x500;
constexpr unsigned int kThermal = 0x501;

struct Frame {
    std::string timestamp;
    std::string elapsed_text;
    double elapsed_seconds{};
    std::string session;
    std::string source;
    unsigned int id{};
    std::array<std::uint8_t, 8> data{};
};

// Fixed-position binary decoding: little-endian means the least significant
// byte is stored first. E.g. 0x04D2 is bytes D2 04, representing 1234.
std::uint16_t u16(const std::array<std::uint8_t, 8>& data, std::size_t offset) {
    return static_cast<std::uint16_t>(
        static_cast<unsigned int>(data[offset]) |
        (static_cast<unsigned int>(data[offset + 1]) << 8U));
}

std::int16_t i16(const std::array<std::uint8_t, 8>& data, std::size_t offset) {
    const std::uint16_t raw = u16(data, offset);
    // Convert two's-complement bytes without relying on an implementation-
    // defined narrowing conversion for raw values above INT16_MAX.
    return static_cast<std::int16_t>(
        raw <= 32767U ? static_cast<int>(raw) : static_cast<int>(raw) - 65536);
}

int hex_nibble(char c) {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    throw std::runtime_error("payload contains a non-hexadecimal character");
}

std::vector<std::string> split_pipes(const std::string& line) {
    std::vector<std::string> parts;
    std::size_t start = 0;
    while (true) {
        const auto pos = line.find('|', start);
        parts.push_back(line.substr(start, pos == std::string::npos ? pos : pos - start));
        if (pos == std::string::npos) break;
        start = pos + 1;
    }
    return parts;
}

Frame parse_frame(const std::string& line, std::size_t line_number) {
    const auto cols = split_pipes(line);
    if (cols.size() != 6) {
        throw std::runtime_error("line " + std::to_string(line_number) + ": expected exactly 6 pipe-separated fields");
    }
    Frame f;
    f.timestamp = cols[0];
    f.elapsed_text = cols[1];
    f.session = cols[2];
    f.source = cols[3];

    // The metadata is outside the CAN frame. Validate it because we reuse it
    // in JSON output and must not accidentally write invalid JSON.
    static const std::regex utc_pattern(R"(^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$)");
    static const std::regex session_pattern(R"(^[A-Za-z0-9._-]+$)");
    if (!std::regex_match(f.timestamp, utc_pattern)) {
        throw std::runtime_error("line " + std::to_string(line_number) + ": invalid UTC timestamp format");
    }
    if (!std::regex_match(f.session, session_pattern) || f.source != "simulation") {
        throw std::runtime_error("line " + std::to_string(line_number) + ": invalid session/source metadata");
    }
    try {
        std::size_t consumed = 0;
        f.elapsed_seconds = std::stod(f.elapsed_text, &consumed);
        if (consumed != f.elapsed_text.size() || !std::isfinite(f.elapsed_seconds) || f.elapsed_seconds < 0) {
            throw std::invalid_argument("bad elapsed time");
        }
    } catch (const std::exception&) {
        throw std::runtime_error("line " + std::to_string(line_number) + ": invalid elapsed seconds");
    }

    if (cols[4] == "0x500") f.id = kMotion;
    else if (cols[4] == "0x501") f.id = kThermal;
    else throw std::runtime_error("line " + std::to_string(line_number) + ": unsupported synthetic CAN ID");

    if (cols[5].size() != 16) {
        throw std::runtime_error("line " + std::to_string(line_number) + ": CAN payload must have exactly 16 hex characters (8 bytes)");
    }
    try {
        for (std::size_t i = 0; i < 8; ++i) {
            f.data[i] = static_cast<std::uint8_t>(
                (hex_nibble(cols[5][2 * i]) << 4) | hex_nibble(cols[5][2 * i + 1]));
        }
    } catch (const std::runtime_error& e) {
        throw std::runtime_error("line " + std::to_string(line_number) + ": " + e.what());
    }
    return f;
}

std::string decode_pair(const Frame& first, const Frame& second,
                        bool& has_previous_seq, std::uint16_t& previous_seq) {
    if (first.id == second.id) {
        throw std::runtime_error("duplicate CAN ID in one two-frame sample");
    }
    if (first.timestamp != second.timestamp || first.elapsed_text != second.elapsed_text ||
        first.session != second.session || first.source != second.source) {
        throw std::runtime_error("two frames from different telemetry samples were paired");
    }
    const Frame& motion = first.id == kMotion ? first : second;
    const Frame& thermal = first.id == kThermal ? first : second;
    const std::uint16_t motion_seq = u16(motion.data, 6);
    const std::uint16_t thermal_seq = u16(thermal.data, 6);
    if (motion_seq != thermal_seq) {
        throw std::runtime_error("sequence mismatch inside a two-frame sample");
    }
    if (has_previous_seq && motion_seq != static_cast<std::uint16_t>(previous_seq + 1U)) {
        throw std::runtime_error("missing, repeated, or out-of-order sample sequence");
    }
    previous_seq = motion_seq;
    has_previous_seq = true;

    if (thermal.data[4] != 1 || thermal.data[5] != 0) {
        throw std::runtime_error("unsupported protocol version or nonzero reserved byte");
    }
    const double speed = u16(motion.data, 0) / 100.0;
    const double rpm = u16(motion.data, 2) / 10.0;
    const double throttle = u16(motion.data, 4) / 10.0;
    const double coolant = i16(thermal.data, 0) / 100.0;
    const double intake = i16(thermal.data, 2) / 100.0;

    // Validation uses the same physical limits as our Phase 1 JSON schema.
    if (speed > 400 || rpm > 10000 || throttle > 100 ||
        coolant < -40 || coolant > 200 || intake < -40 || intake > 150) {
        throw std::runtime_error("decoded signal violates declared telemetry ranges");
    }

    // Metadata was restricted to safe formats above, so JSON strings cannot
    // contain quote/backslash/control characters. Values are quantized exactly
    // to the declared decimal precision in our synthetic protocol.
    std::ostringstream out;
    out << "{\"schema_version\":\"1.0\",\"session_id\":\"" << motion.session
        << "\",\"source\":\"simulation\",\"elapsed_s\":" << motion.elapsed_text
        << ",\"timestamp_utc\":\"" << motion.timestamp << "\""
        << std::fixed
        << ",\"engine_rpm\":" << std::setprecision(1) << rpm
        << ",\"vehicle_speed_kph\":" << std::setprecision(2) << speed
        << ",\"coolant_temp_c\":" << std::setprecision(2) << coolant
        << ",\"intake_temp_c\":" << std::setprecision(2) << intake
        << ",\"throttle_pct\":" << std::setprecision(1) << throttle
        << ",\"quality\":\"valid\"}";
    return out.str();
}

void print_usage() {
    std::cerr << "Usage: q50-can-decoder --input <synthetic.canlog> --output <decoded.jsonl>\n";
}

int run(const fs::path& input_path, const fs::path& output_path) {
    if (fs::absolute(input_path).lexically_normal() == fs::absolute(output_path).lexically_normal()) {
        throw std::runtime_error("input and output must be different files");
    }
    std::ifstream input(input_path);
    if (!input) throw std::runtime_error("cannot open input file: " + input_path.string());
    if (!output_path.parent_path().empty()) fs::create_directories(output_path.parent_path());
    const fs::path temporary = output_path.string() + ".tmp";
    std::size_t samples = 0;
    std::size_t line_number = 0;
    bool has_previous_seq = false;
    std::uint16_t previous_seq = 0;
    bool pending = false;
    Frame first;

    try {
        std::ofstream out(temporary, std::ios::trunc);
        if (!out) throw std::runtime_error("cannot open temporary output file");
        std::string line;
        while (std::getline(input, line)) {
            ++line_number;
            if (line.empty()) continue;
            const Frame frame = parse_frame(line, line_number);
            if (!pending) {
                first = frame;
                pending = true;
            } else {
                try {
                    out << decode_pair(first, frame, has_previous_seq, previous_seq) << '\n';
                } catch (const std::runtime_error& e) {
                    throw std::runtime_error("lines near " + std::to_string(line_number) + ": " + e.what());
                }
                ++samples;
                pending = false;
            }
        }
        if (input.bad()) throw std::runtime_error("error while reading CAN log");
        if (pending) throw std::runtime_error("incomplete trailing sample: missing CAN frame");
        if (samples == 0) throw std::runtime_error("CAN log contains no complete samples");
        out.close();
        if (!out) throw std::runtime_error("error while writing decoded output");

        // Replace output only after the full input passes validation.
        if (fs::exists(output_path)) fs::remove(output_path);
        fs::rename(temporary, output_path);
    } catch (...) {
        std::error_code ignored;
        fs::remove(temporary, ignored);
        throw;
    }
    std::cout << "Decoded " << samples * 2 << " CAN frames into " << samples << " telemetry samples\n"
              << "Decoded output: " << fs::absolute(output_path).string() << '\n';
    return 0;
}

}  // namespace

int main(int argc, char* argv[]) {
    fs::path input;
    fs::path output;
    for (int i = 1; i < argc; ++i) {
        const std::string arg = argv[i];
        if ((arg == "--input" || arg == "--output") && i + 1 < argc) {
            const fs::path value = argv[++i];
            if (arg == "--input") input = value;
            else output = value;
        } else {
            print_usage();
            return 2;
        }
    }
    if (input.empty() || output.empty()) {
        print_usage();
        return 2;
    }
    try {
        return run(input, output);
    } catch (const std::exception& e) {
        std::cerr << "Decode error: " << e.what() << '\n';
        return 2;
    }
}
