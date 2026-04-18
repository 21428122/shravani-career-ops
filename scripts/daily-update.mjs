#!/usr/bin/env node
/**
 * daily-update.mjs
 *
 * 1. Runs the portal scan (scan.mjs in parent testing folder).
 * 2. Parses data/pipeline.md and classifies each queued job into a niche.
 * 3. Generates a tailored PDF per company from templates/resume-template.html + niches.json.
 * 4. Rebuilds INDEX.md with apply links.
 * 5. git add / commit / push to the GitHub repo.
 *
 * Designed to be run daily at 7 AM ET via Windows Task Scheduler.
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const TESTING = resolve(ROOT, '..');
const PDFS_DIR = join(ROOT, 'pdfs');
const HTML_DIR = join(ROOT, 'html');
const TEMPLATE_PATH = join(ROOT, 'templates', 'resume-template.html');
const NICHES_PATH = join(ROOT, 'templates', 'niches.json');
const CONTACTS_PATH = join(ROOT, 'data', 'contacts.json');
const PIPELINE_PATH = join(TESTING, 'data', 'pipeline.md');
const INDEX_PATH = join(ROOT, 'INDEX.md');
const LOG_PATH = join(ROOT, 'daily-log.txt');

mkdirSync(PDFS_DIR, { recursive: true });
mkdirSync(HTML_DIR, { recursive: true });

function log(msg) {
  const stamp = new Date().toISOString();
  const line = `[${stamp}] ${msg}`;
  console.log(line);
  try { writeFileSync(LOG_PATH, line + '\n', { flag: 'a' }); } catch {}
}

function slugify(s) {
  return s.replace(/[^a-zA-Z0-9]+/g, '').slice(0, 30);
}

function datestampYYYYMM() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function classifyNiche(company, title, niches) {
  const text = (company + ' ' + title).toLowerCase();
  for (const [name, cfg] of Object.entries(niches)) {
    if (name === 'generic') continue;
    for (const kw of cfg.keywords) {
      if (text.includes(kw.toLowerCase())) return name;
    }
  }
  return 'generic';
}

function parsePipeline(content) {
  const entries = [];
  const seen = new Set();
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    const m = line.match(/^- \[ \]\s+(\S+)(?:\s*\|\s*([^|]+?))?(?:\s*\|\s*(.+?))?\s*$/);
    if (!m) continue;
    const url = m[1];
    const company = (m[2] || 'Unknown').trim();
    const dedupKey = `${url}|${company.toLowerCase()}`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);
    entries.push({
      url,
      company,
      title: (m[3] || 'Product Role').trim(),
    });
  }
  return entries;
}

function run() {
  log('=== Daily update started ===');

  // 1. Run scan
  try {
    log('Running scan.mjs…');
    execSync('node scan.mjs', { cwd: TESTING, stdio: 'inherit' });
  } catch (e) {
    log(`scan.mjs failed: ${e.message}`);
  }

  // 2. Parse pipeline
  if (!existsSync(PIPELINE_PATH)) {
    log('No pipeline.md found — aborting');
    return;
  }
  const entries = parsePipeline(readFileSync(PIPELINE_PATH, 'utf-8'));
  log(`Found ${entries.length} queued applications`);

  // 3. Load niche config + template
  const niches = JSON.parse(readFileSync(NICHES_PATH, 'utf-8'));
  const template = readFileSync(TEMPLATE_PATH, 'utf-8');
  const stamp = datestampYYYYMM();

  // 4. Generate PDFs
  const results = [];
  for (const entry of entries) {
    const niche = classifyNiche(entry.company, entry.title, niches);
    const nicheCfg = niches[niche];
    const companySlug = slugify(entry.company);
    const filename = `ShravaniDorlikar-PMIntern-${companySlug}-${stamp}.pdf`;
    const pdfPath = join(PDFS_DIR, filename);

    results.push({ ...entry, niche, filename });

    if (existsSync(pdfPath)) {
      log(`Skip (exists): ${filename}`);
      continue;
    }

    // Build headline + skills
    const headline = nicheCfg.headline
      .replace('{{ROLE}}', entry.title)
      .replace('{{COMPANY}}', entry.company);
    const skillsHtml = nicheCfg.skills
      .map(s => `<p><span class="label">${s.label}:</span> ${s.items}</p>`)
      .join('\n    ');
    const html = template
      .replace('{{HEADLINE}}', headline)
      .replace('{{SKILLS}}', skillsHtml);

    const htmlPath = join(HTML_DIR, `${companySlug}.html`);
    writeFileSync(htmlPath, html, 'utf-8');

    // Generate PDF via generate-pdf.mjs in parent
    try {
      log(`Generating PDF: ${filename} (niche=${niche})`);
      execSync(
        `node generate-pdf.mjs "${htmlPath}" "${pdfPath}" --format=letter`,
        { cwd: TESTING, stdio: 'pipe' }
      );
    } catch (e) {
      log(`PDF failed for ${entry.company}: ${e.message}`);
    }
  }

  // 5. Load contacts
  let contacts = {};
  try {
    if (existsSync(CONTACTS_PATH)) {
      contacts = JSON.parse(readFileSync(CONTACTS_PATH, 'utf-8'));
    }
  } catch (e) {
    log(`contacts.json parse failed: ${e.message}`);
  }

  function contactFor(company) {
    // Tolerant lookup: try exact, then normalized casefold
    if (contacts[company]) return contacts[company];
    const key = Object.keys(contacts).find(k => k.toLowerCase() === company.toLowerCase());
    return key ? contacts[key] : null;
  }

  function nicheTemplate(niche) {
    if (niche === 'healthtech' || niche === 'nocode' || niche === 'ai_agents' || niche === 'climate')
      return 'outreach/tier2-cold-email-templates.md (Template A or B)';
    if (niche === 'devtools' || niche === 'cybersecurity' || niche === 'fintech')
      return 'outreach/tier2-cold-email-templates.md (Template C)';
    return 'outreach/tier1-linkedin-dms.md (adapt)';
  }

  // 6. Build INDEX.md
  const nowET = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });
  let idx = `# Shravani's PM Internship Resume Pipeline\n\n`;
  idx += `_Auto-refreshed every day at 7:00 AM ET._\n`;
  idx += `_Last update: **${nowET}**_\n\n`;
  idx += `Total active applications: **${results.length}**\n\n`;
  idx += `**👉 Start here:** [APPLY-PLAYBOOK.md](APPLY-PLAYBOOK.md) — the step-by-step for each application.\n\n`;

  const byNiche = {};
  for (const r of results) (byNiche[r.niche] = byNiche[r.niche] || []).push(r);

  idx += `## By niche\n\n`;
  for (const [niche, list] of Object.entries(byNiche).sort()) {
    idx += `- **${niche}** — ${list.length}\n`;
  }
  idx += `\n## Active applications\n\n`;
  idx += `| # | Company | Role | Niche | Resume | Apply | DM first (LinkedIn) | DM template |\n`;
  idx += `|---|---------|------|-------|--------|-------|---------------------|-------------|\n`;
  results.forEach((r, i) => {
    const cs = contactFor(r.company);
    let dmCell = '_no contact researched yet_';
    if (cs && cs.length > 0) {
      const top = cs[0];
      dmCell = `[**${top.name}** — ${top.role}](${top.linkedin})`;
    }
    const tpl = nicheTemplate(r.niche);
    idx += `| ${i + 1} | **${r.company}** | ${r.title} | \`${r.niche}\` | [PDF](pdfs/${r.filename}) | [→ Apply](${r.url}) | ${dmCell} | [${tpl.split('/').pop()}](${tpl.replace(/ .*$/, '')}) |\n`;
  });

  idx += `\n## All LinkedIn contacts (3 per company)\n\n`;
  idx += `See [contacts.md](contacts.md) for the full list with "why this person" notes.\n\n`;

  idx += `---\n\n`;
  idx += `## How this works\n\n`;
  idx += `- **Scanner** polls Greenhouse / Ashby / Lever APIs daily for new PM/APM/Intern roles.\n`;
  idx += `- **Classifier** matches each posting to a niche using keyword matching on company + title.\n`;
  idx += `- **Generator** fills the HTML template with niche-specific headline + skills and renders a 1-page PDF via Playwright.\n`;
  idx += `- **Contacts** for each company are in [\`data/contacts.json\`](data/contacts.json); the top contact appears in the table above.\n`;
  idx += `- **Outreach templates** are in [\`outreach/\`](outreach/) — pick the one matching the niche.\n`;
  writeFileSync(INDEX_PATH, idx, 'utf-8');

  // 6b. Build contacts.md (human-readable)
  let cMd = `# Outreach Contacts — All Active Companies\n\n`;
  cMd += `_Maintained manually in [\`data/contacts.json\`](data/contacts.json). Edit there, re-run \`scripts/daily-update.mjs\`, and this file + INDEX.md regenerate._\n\n`;
  for (const r of results) {
    const cs = contactFor(r.company);
    cMd += `## ${r.company} — ${r.title}\n\n`;
    cMd += `[→ Apply here](${r.url}) · [Tailored PDF](pdfs/${r.filename})\n\n`;
    if (!cs || cs.length === 0) {
      cMd += `_No contacts researched yet. Add to \`data/contacts.json\` to surface._\n\n`;
      continue;
    }
    cMd += `| # | Name | Role | LinkedIn | Why |\n|---|------|------|----------|-----|\n`;
    cs.forEach((p, i) => {
      cMd += `| ${i + 1} | ${p.name} | ${p.role} | [profile](${p.linkedin}) | ${p.why} |\n`;
    });
    cMd += `\n`;
  }
  writeFileSync(join(ROOT, 'contacts.md'), cMd, 'utf-8');

  // 6. Commit + push
  try {
    execSync('git add -A', { cwd: ROOT, stdio: 'pipe' });
    const status = execSync('git status --porcelain', { cwd: ROOT, encoding: 'utf-8' });
    if (!status.trim()) {
      log('No git changes to commit');
    } else {
      const date = new Date().toISOString().slice(0, 10);
      execSync(
        `git commit -m "Daily refresh ${date}: ${results.length} applications tracked"`,
        { cwd: ROOT, stdio: 'pipe' }
      );
      execSync('git push origin main', { cwd: ROOT, stdio: 'pipe' });
      log(`✅ Pushed ${results.length} applications to GitHub`);
    }
  } catch (e) {
    log(`git push failed: ${e.message}`);
  }

  log('=== Daily update complete ===\n');
}

run();
