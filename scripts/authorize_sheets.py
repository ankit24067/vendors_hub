"""One-time consent flow: saves a READ-WRITE Google Sheets token.

Run from the vendors_hub folder:
    venv\\Scripts\\python.exe scripts\\authorize_sheets.py

Opens a Google consent URL; sign in with an account that has EDITOR access
to the reorder sheet. Paste the full redirected URL back here.
Saves credentials/token_rw.pickle — then set MOCK_MODE=false in .env.

(reco's token.pickle is spreadsheets.readonly — this one is separate.)
"""

import os
import pickle
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ["OAUTHLIB_INSECURE_TRANSPORT"] = "1"

from google_auth_oauthlib.flow import Flow

from config import Config

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",   # read + write
    "https://www.googleapis.com/auth/drive.file",     # invoice PDFs to Drive later
]


def main():
    flow = Flow.from_client_secrets_file(
        Config.GOOGLE_OAUTH_CREDS_PATH,
        scopes=SCOPES,
        redirect_uri="http://127.0.0.1:8000/",
    )
    auth_url, _ = flow.authorization_url(prompt="consent", access_type="offline")

    print("\nOPEN THIS URL AND SIGN IN (account needs editor access to the sheet):\n")
    print(auth_url)
    resp = input("\nAfter login, paste the FULL redirected URL here:\n").strip()
    flow.fetch_token(authorization_response=resp)

    with open(Config.SHEETS_TOKEN_PATH, "wb") as f:
        pickle.dump(flow.credentials, f)
    print(f"\nSaved read-write token to {Config.SHEETS_TOKEN_PATH}")
    print("Now set MOCK_MODE=false in .env and restart the app.")

    # quick smoke test
    import gspread
    client = gspread.authorize(flow.credentials)
    sheet = client.open_by_key(Config.GOOGLE_SHEET_ID)
    print("Sheet opened OK:", sheet.title)
    print("Tabs:", [ws.title for ws in sheet.worksheets()])


if __name__ == "__main__":
    main()
