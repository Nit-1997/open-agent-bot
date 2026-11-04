"use client";

import { Play } from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import { DEMO_VIDEO_ID, YOUTUBE_EMBED_ORIGIN } from "@/lib/youtube";

const EDGE_BUTTON = "absolute bg-gradient-to-b from-[#9a9aa0] via-[#5c5c62] to-[#9a9aa0]";

export function TabletVideo() {
  const [playing, setPlaying] = useState(false);

  return (
    <div id="landing-tablet" className="relative mx-auto w-full max-w-[300px] sm:max-w-[380px] lg:max-w-[440px]">
      <span
        id="landing-tablet-power"
        aria-hidden="true"
        className={`${EDGE_BUTTON} -top-[3px] right-[18%] h-[3px] w-[52px] rounded-t-sm`}
      />
      <span
        id="landing-tablet-volume-up"
        aria-hidden="true"
        className={`${EDGE_BUTTON} top-[11%] -right-[3px] h-[44px] w-[3px] rounded-r-sm`}
      />
      <span
        id="landing-tablet-volume-down"
        aria-hidden="true"
        className={`${EDGE_BUTTON} top-[calc(11%+54px)] -right-[3px] h-[44px] w-[3px] rounded-r-sm`}
      />

      <div
        id="landing-tablet-body"
        className="rounded-[38px] bg-gradient-to-br from-[#b8b8bd] via-[#6e6e74] to-[#a6a6ac] p-[3px] shadow-[0_40px_90px_rgba(0,0,0,0.55),0_10px_30px_rgba(0,0,0,0.35)]"
      >
        <div id="landing-tablet-bezel" className="relative rounded-[35px] bg-[#0a0a0b] p-[14px] sm:p-[16px]">
          <span
            id="landing-tablet-camera"
            aria-hidden="true"
            className="absolute top-[5px] left-1/2 h-[6px] w-[6px] -translate-x-1/2 rounded-full bg-[#1c2230] ring-1 ring-white/10 sm:top-[6px]"
          />
          <div id="landing-tablet-screen" className="relative aspect-[4/5] overflow-hidden rounded-[22px] bg-[#1f4b50]">
            {playing ? (
              <iframe
                id="landing-tablet-iframe"
                src={`${YOUTUBE_EMBED_ORIGIN}/embed/${DEMO_VIDEO_ID}?autoplay=1&rel=0&playsinline=1&modestbranding=1`}
                title="Open Agent demo"
                allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                referrerPolicy="strict-origin-when-cross-origin"
                allowFullScreen
                className="absolute inset-0 h-full w-full"
              />
            ) : (
              <button
                id="landing-tablet-play"
                type="button"
                onClick={() => setPlaying(true)}
                aria-label="Play the Open Agent demo video"
                className="group absolute inset-0 h-full w-full"
              >
                <Image
                  id="landing-tablet-poster"
                  src="/landing/demo-video-poster.jpg"
                  alt=""
                  fill
                  sizes="(min-width: 1024px) 410px, (min-width: 640px) 350px, 270px"
                  priority
                  className="object-cover"
                />
                <span
                  id="landing-tablet-overlay"
                  className="absolute inset-0 flex items-center justify-center bg-black/10 transition-colors group-hover:bg-black/25"
                >
                  <span
                    id="landing-tablet-play-icon"
                    className="flex h-[76px] w-[76px] items-center justify-center rounded-full border border-white/25 bg-white/20 backdrop-blur-md transition group-hover:scale-110 group-hover:bg-white/30"
                  >
                    <Play aria-hidden="true" className="ml-1 h-8 w-8 fill-white text-white" />
                  </span>
                </span>
                <span
                  id="landing-tablet-sheen"
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 bg-[linear-gradient(120deg,rgba(255,255,255,0.12)_0%,rgba(255,255,255,0)_40%)]"
                />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
