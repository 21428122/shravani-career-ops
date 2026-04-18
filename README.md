# Shravani's PM Internship Resume Pipeline

Auto-generated tailored resumes for every PM internship / APM role in the active queue.

**See [INDEX.md](INDEX.md)** for the current list of applications with one-click apply links.

## What this repo does

Every day at 7:00 AM ET, a scheduled job on the local machine:

1. **Scans** Greenhouse, Ashby, Lever APIs for new PM / APM / Intern roles at 76 tracked companies (healthtech, devtools, climate, no-code, AI agents, fintech, cybersecurity, big tech).
2. **Classifies** each new posting into a niche using keyword matching on company + title.
3. **Generates a tailored resume PDF** per role — custom headline, niche-relevant skills ordering, same core content.
4. **Commits and pushes** every new PDF + a refreshed [INDEX.md](INDEX.md) to this repo.

## Folder layout

```
repo/
├── INDEX.md            ← the live pipeline (read this first)
├── pdfs/               ← tailored resume PDFs, one per application
├── html/               ← source HTML for each PDF (regeneratable)
├── templates/
│   ├── resume-template.html   ← the master layout
│   └── niches.json            ← niche definitions + keyword classifier
├── scripts/
│   └── daily-update.mjs       ← the daily refresh pipeline
└── daily-update.bat    ← Windows Task Scheduler entry point
```

## Niches currently supported

`healthtech`, `devtools`, `climate`, `nocode`, `ai_agents`, `cybersecurity`, `fintech`, `generic`

Each niche has its own headline template + skill-line ordering tuned to what that category's hiring managers care about.

## Manual run

```
cd path\to\repo
node scripts\daily-update.mjs
```
