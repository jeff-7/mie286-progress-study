# MIE286 Progress Study

A browser-based experiment that compares two progress feedback styles during an opposite-arrow reaction task:

- Numeric progress
- Animated progress bar

The repository includes:

- A static front-end (`index.html`)
- A Google Apps Script backend for Google Sheets storage (`apps-script/Code.gs`)
- A minimal Apps Script manifest (`apps-script/appsscript.json`)

## Repository Structure

```text
mie286-progress-study/
├── index.html
├── README.md
├── .gitignore
└── apps-script/
    ├── Code.gs
    └── appsscript.json
```

## What the Experiment Does

Participants:

- complete a practice round
- complete 2 main blocks
- respond with the opposite arrow key
- optionally opt in to a leaderboard

The front-end records:

- participant ID
- nickname
- session ID
- device type
- input mode
- sound setting
- trial-by-trial responses
- summary metrics for both conditions

## Front-End Configuration

Open `index.html` and update the `CONFIG` object:

```js
const CONFIG = {
  practiceTrials: 10,
  blockTrials: 100,
  interTrialMs: 300,
  countdownSeconds: 3,
  autosaveEveryTrials: 10,
  googleScriptUrl: 'PASTE_YOUR_WEB_APP_URL_HERE',
  enableUpload: true,
  stimuli: [ ... ]
};
```

Before you deploy Apps Script, keep this as:

```js
googleScriptUrl: '',
enableUpload: false,
```

After you deploy Apps Script as a web app, paste the deployment URL and set `enableUpload: true`.

## Google Sheets / Apps Script Backend

The Apps Script backend expects one Google Spreadsheet with two sheets:

- `Trials`
- `Leaderboard`

The script creates them automatically if they do not exist.

### Main Endpoints

- `doPost(e)`
  - receives participant payloads from the front-end
  - upserts one leaderboard summary per `participantId + sessionId`
  - replaces the participant's trial rows for the current session

- `doGet(e)`
  - supports `?mode=leaderboard`
  - returns public leaderboard entries for opted-in participants only

### Data Safety Notes

This backend includes:

- automatic sheet creation
- header normalization
- script locking via `LockService`
- filtering so partial autosaves do not appear in the leaderboard

## Recommended Deployment Flow

### 1. Create the spreadsheet

Create a new Google Sheet that will store experiment data.

### 2. Create a bound Apps Script project

From the spreadsheet:

- open `Extensions -> Apps Script`
- replace the default script with the contents of `apps-script/Code.gs`
- if needed, update the manifest using `apps-script/appsscript.json`

### 3. Deploy as a web app

In Apps Script:

- click `Deploy`
- click `New deployment`
- choose `Web app`
- set execution to your account
- set access appropriately for your participants
- deploy and copy the web app URL

### 4. Update the front-end

Paste the web app URL into `index.html`:

```js
googleScriptUrl: 'YOUR_DEPLOYED_WEB_APP_URL',
enableUpload: true,
```

### 5. Host the front-end

You can host `index.html` using any static hosting option, such as:

- GitHub Pages
- Netlify
- Vercel
- a university web server
- local testing in a browser

## Testing Checklist

Before collecting real data, verify that:

- the web app URL responds successfully
- a completed session writes rows into `Trials`
- a finished non-partial session updates `Leaderboard`
- participants who do not opt in are excluded from the leaderboard
- `?mode=leaderboard` returns JSON entries

## Suggested GitHub Workflow

```bash
git init
git add .
git commit -m "Initial experiment setup"
```

Then create a GitHub repository and push this folder.

## Notes

- This project uses a single-file front-end for portability.
- If you redeploy the Apps Script web app with a new version, keep `index.html` updated with the latest URL if it changes.
- If you want stricter data governance, add validation and access restrictions in `Code.gs` before running the study.
