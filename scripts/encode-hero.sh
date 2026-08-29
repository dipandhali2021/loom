#!/usr/bin/env bash
#
# Encode one hero clip for the login screen.
#
#   ./scripts/encode-hero.sh <source.mp4> <out-name> [start-seconds]
#
# Crops the source to 9:19.5 portrait about its centre, trims 6s from
# `start-seconds` (default 0), strips audio and writes a faststart H.264 file to
# assets/videos/hero/<out-name>.mp4.
#
# Height is whatever the crop yields, so a source is never upscaled: a 1080p
# landscape clip only has ~498px of real width inside a 9:19.5 window, and
# stretching that to 1080 would bake in a 2.2x blur. The GPU scales it at draw
# time instead. Every output shares the aspect ratio, so `contentFit="cover"`
# treats them identically whatever their pixel size.
set -euo pipefail

SRC=${1:?usage: encode-hero.sh <source.mp4> <out-name> [start-seconds]}
OUT=${2:?usage: encode-hero.sh <source.mp4> <out-name> [start-seconds]}
START=${3:-0}

ASPECT_W=9
ASPECT_H=19.5
DURATION=6
# 1080x2340 is the target frame. Clips whose crop is narrower than that stay at
# their own size rather than being upscaled to meet it.
MAX_W=1080

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
DEST="$ROOT/assets/videos/hero/$OUT.mp4"

IFS=, read -r SRC_W SRC_H < <(
  ffprobe -v error -select_streams v:0 -show_entries stream=width,height \
    -of csv=p=0 "$SRC"
)

# The tallest 9:19.5 window that fits, then rounded to even (yuv420p needs it).
CROP_W=$(awk -v w="$SRC_W" -v h="$SRC_H" -v aw=$ASPECT_W -v ah=$ASPECT_H \
  'BEGIN { c = h * aw / ah; if (c > w) c = w; printf "%d", int(c / 2) * 2 }')
OUT_W=$(( CROP_W < MAX_W ? CROP_W : MAX_W ))
OUT_H=$(awk -v w="$OUT_W" -v aw=$ASPECT_W -v ah=$ASPECT_H \
  'BEGIN { printf "%d", int(w * ah / aw / 2) * 2 }')

echo "$SRC  ${SRC_W}x${SRC_H}  ->  crop ${CROP_W}x${SRC_H}  ->  ${OUT_W}x${OUT_H}"

ffmpeg -hide_banner -loglevel error -y \
  -ss "$START" -t "$DURATION" -i "$SRC" \
  -vf "crop=${CROP_W}:ih,scale=${OUT_W}:${OUT_H}:flags=lanczos" \
  -c:v libx264 -profile:v high -crf 26 -preset slow -pix_fmt yuv420p \
  -r 24 -an -movflags +faststart \
  "$DEST"

echo "wrote $DEST ($(du -h "$DEST" | cut -f1))"
