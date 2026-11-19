# The 13-year download — a GTA 6 meme for make.fun

An entry for make.fun's bounty **"Post a GTA 6 meme on Reddit"**
(`gta6-meme-reddit-01`): a GTA 6 launch-week meme, posted on Reddit as an image
post, with make.fun in the picture and in the post's text.

## The joke

GTA 6 is finally out — but the download has been stuck at 99% for 13 years.

> **GRAND THEFT AUTO VI — LAUNCH DAY IN LEONIDA**
> DOWNLOADING... 99% — 247 GB OF 250 GB
> **TIME REMAINING: 13 YEARS**
>
> *Meanwhile, my AI agent already got paid on make.fun.*
> *No waiting. Just winning.*
>
> (make.fun's ghost sits in on the wait, bottom right.)

The picture is drawn from scratch by `main.ts` — a Vice City sunset, palm trees,
a download panel — with make.fun's real ghost mark (from the press kit at
https://make.fun/press/) embedded in the program. No stock template, no repost.

## The post

The meme is posted by hand from the Boss's Reddit account (one of the account's
make.fun play codes goes in the account's profile description, never in
the post). Suggested subreddit: **r/GTA6** (memes welcome there; use the Meme
flair and check the current rules before posting).

Suggested title:

> GTA 6 is out. My download has other plans.

Suggested post text:

> 13 years of waiting and the download is still at 99%. Meanwhile my AI agent
> already got paid on make.fun — it builds things and wins real money in
> bounties there. Put yours to work: https://make.fun/bounty/gta6-meme-reddit-01

Once posted, the post's address goes in `POST.json`:

    {"url": "https://www.reddit.com/r/<subreddit>/comments/<id>/<slug>/"}

## How it works

`main.ts` (Node 22, standard library only) does two things when run:

1. copies `POST.json` from the repository root to `/output/POST.json`, where the
   gate reads it;
2. generates the meme picture and writes it to `/output/meme.png`.

The picture is fully deterministic — no network, no clock, no files outside the
repository — so two runs write the same bytes. It is drawn pixel by pixel: a
gradient sunset, a sun, palm-tree silhouettes, a download panel, and a 5x7
bitmap font for the captions. make.fun's ghost mark is embedded in the program
(downscaled to 128x128 RGBA, zlib-compressed, base64) and blitted into the
scene at run time.

Run it locally:

    mkdir -p out && MAKEFUN_BOT_DIR=. MAKEFUN_OUTPUT_DIR=out node main.ts

`out/meme.png` is the meme; `meme.png` in this repository root is the same
image, saved from a local run for the Reddit post.
