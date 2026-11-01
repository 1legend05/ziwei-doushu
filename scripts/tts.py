#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
TTS 合成脚本（免 API Key）：
  edge-tts(微软 Edge 免费语音) -> mp3 -> PyAV 解码 -> 重采样 16kHz -> 16bit mono WAV

用法:
  python tts.py "<文本>" <输出.wav> [音色]

音色默认 zh-CN-XiaoxiaoNeural（晓晓，女声）。可选 zh-CN-YunxiNeural（云希，男声）。
"""
import sys
import io
import os
import asyncio
import av
import numpy as np
import wave

VOICE = "zh-CN-XiaoxiaoNeural"
TARGET_RATE = 16000


def decode_mp3_to_pcm(mp3_bytes: bytes):
    """解码 mp3 -> float32 PCM(单声道) + 采样率"""
    container = av.open(io.BytesIO(mp3_bytes))
    stream = container.streams.audio[0]
    rate = stream.codec_context.sample_rate or 24000
    chunks = []
    for frame in container.decode(stream):
        arr = frame.to_ndarray()
        # arr shape: (channels, samples) 或 (samples,)
        if arr.ndim == 2:
            arr = arr[0]  # 取左声道
        chunks.append(arr.astype(np.float32))
    container.close()
    if not chunks:
        raise RuntimeError("no audio decoded")
    pcm = np.concatenate(chunks)
    return pcm, rate


def resample(pcm: np.ndarray, src_rate: int, dst_rate: int) -> np.ndarray:
    """线性插值重采样"""
    if src_rate == dst_rate:
        return pcm
    n_out = int(round(len(pcm) * dst_rate / src_rate))
    x_old = np.linspace(0, 1, len(pcm), dtype=np.float64)
    x_new = np.linspace(0, 1, n_out, dtype=np.float64)
    return np.interp(x_new, x_old, pcm).astype(np.float32)


def write_wav(path: str, pcm16: np.ndarray, rate: int):
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm16.tobytes())


async def synth(text: str, voice: str) -> bytes:
    import edge_tts
    comm = edge_tts.Communicate(text, voice)
    buf = bytearray()
    async for chunk in comm.stream():
        if chunk["type"] == "audio":
            buf.extend(chunk["data"])
    return bytes(buf)


def main():
    if len(sys.argv) < 3:
        print("usage: python tts.py <text> <out.wav> [voice]", file=sys.stderr)
        sys.exit(2)
    text = sys.argv[1]
    out_path = sys.argv[2]
    voice = sys.argv[3] if len(sys.argv) > 3 else VOICE
    if not text.strip():
        print("empty text", file=sys.stderr)
        sys.exit(2)

    try:
        mp3 = asyncio.run(synth(text, voice))
        pcm_f, src_rate = decode_mp3_to_pcm(mp3)
        pcm_f = resample(pcm_f, src_rate, TARGET_RATE)
        # float -> int16，限幅
        pcm_i = np.clip(pcm_f * 32767.0, -32768, 32767).astype(np.int16)
        write_wav(out_path, pcm_i, TARGET_RATE)
        print(f"OK {out_path} {os.path.getsize(out_path)} bytes", file=sys.stderr)
    except Exception as e:  # noqa
        print(f"ERR {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
