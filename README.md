# Gold Jewellers Billing System (Flask + MongoDB)

## Tech Stack
- Frontend: HTML, Bootstrap, JavaScript
- Backend: Python (Flask)
- Database: MongoDB (`pymongo`)
- PDF: `reportlab`
- Excel Export: `pandas` + `openpyxl`

## Setup (Local)
1. Create/activate a Python virtual environment.
   - Windows (PowerShell):
     - `python -m venv venv`
     - `venv\\Scripts\\Activate.ps1`
2. Install dependencies:
   - `pip install -r requirements.txt`
3. Ensure MongoDB is running.
   - Default connection string used by the app: `mongodb://localhost:27017`
   - Default database/collection:
     - DB: `gold_jewellers`
     - Bills collection: `bills`
     - Counter collection: `counters`
4. Configure shop + GST/BANK details (optional, recommended).
   - The project reads configuration from **environment variables** in `config.py`.
   - See `.env.example` for the variable names.
   - In PowerShell (current terminal only), for example:
     - `$env:SHOP_GSTIN="37XXXXXXXXXXXX"`
     - `$env:SHOP_PHONE="+91-XXXXXXXXXX"`
     - `$env:BANK_IFSC="KKBK6007839"`
5. Start the server:
   - `python app.py`
6. Open in browser:
   - Billing page: `http://localhost:5000/billing`
   - Reports page: `http://localhost:5000/reports`

## Running Notes
- If MongoDB is unreachable, the server UI may still open, but API calls will fail until MongoDB is reachable.
- Invoice numbers are auto-incremented and persisted in MongoDB (via the `counters` collection).
- To stop the server, press `Ctrl + C` in the terminal where you started `python app.py`.

## API Endpoints
- `POST /create-bill`
- `GET /bills?from=YYYY-MM-DD&to=YYYY-MM-DD`
- `GET /export-excel?from=YYYY-MM-DD&to=YYYY-MM-DD`
- `GET /generate-pdf?invoice_no=123&download=1`

## Notes
- Invoice numbers are auto-incremented and persist in MongoDB via a counter collection.
- Excel export is filtered by the provided date range and exports one row per invoice item.
- PDF layout uses fixed column widths and grid borders for an invoice-style appearance. Update `config.py` / env vars for shop GSTIN and phone to match your actual bill format.
