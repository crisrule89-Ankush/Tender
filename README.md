# Tender & Bank Guarantee Management

A JavaScript web application with a Node.js/Express server, a SQL Server data store, a configurable tender form, and the existing `login.html` experience converted from Flask/Jinja markup to a working sign-in page.

## Requirements

- Windows 10/11
- Node.js 20 or newer (includes npm)
- SQL Server reachable from this computer
- A SQL Server database and an existing `dbo.userlogin` table

## Hosting on Render

The repository is configured for Render's Node.js web service runtime. Connect the GitHub repository `crisrule89-Ankush/Tender` on branch `main`, with build command `npm ci` and start command `npm start`. The service listens on Render's assigned `PORT` at `0.0.0.0`, and `/healthz` is available as the health-check path. The Node engine range is `>=20 <25` so Render selects a supported Node 24 release rather than an unbounded newest major.

Add these variables in the Render service's **Environment** settings; do not commit `.env` or place secret values in `render.yaml`:

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `SESSION_SECRET` | A newly generated private random value of at least 32 characters |
| `DB_SERVER` | SQL Server host |
| `DB_PORT` | `1433` |
| `DB_NAME` | Existing database name, e.g. `GSMMaster` |
| `DB_USER` | SQL Server login |
| `DB_PASSWORD` | SQL Server password |
| `DB_ENCRYPT` | `true` |
| `DB_TRUST_SERVER_CERTIFICATE` | `false` when SQL Server uses a trusted certificate |
| `LOGIN_USERNAME_COLUMN` | `User_Name` |
| `LOGIN_PASSWORD_COLUMN` | `User_Password` |
| `LOGIN_BRANCH_COLUMN` | `Branch_Name` |
| `LOGIN_ROLE_COLUMN` | `Role` |
| `AUTH_PASSWORD_FORMAT` | Match the current `dbo.userlogin` password representation |
| `AUTO_CREATE_SCHEMA` | `true` if the SQL login can create/alter application tables; otherwise run `sql/schema.sql` as a database administrator first and set `false` |

Generate the session secret locally with `node -e "console.log(require('node:crypto').randomBytes(48).toString('base64'))"` and enter it directly in Render. Never share or commit it. Configure the SQL Server firewall to allow the outbound IP ranges shown in the Render service's **Connect → Outbound** details, and ensure the host accepts TCP connections on port 1433. The SQL account needs access to `GSMMaster`, the existing `dbo.userlogin` table, and the application tables in `dbo`.

After saving environment variables, use **Manual Deploy → Deploy latest commit** or let the connected `main` branch deploy automatically. Set `/healthz` as the health-check path if needed. The Express in-memory session store emits a production warning and does not persist sessions across restarts; users may need to sign in again after a restart or deploy.

## 1. Open the project in VS Code

Open the `Tender_Requisition` folder in VS Code. Open **Terminal → New Terminal**; commands below are intended for PowerShell in the project folder.

## 2. Install JavaScript dependencies

```powershell
npm.cmd install
```

## 3. Configure SQL Server and login

Copy the example environment file:

```powershell
Copy-Item .env.example .env
```

Edit `.env` and set `DB_SERVER`, `DB_PORT`, `DB_NAME`, `DB_USER`, and `DB_PASSWORD` for your SQL Server. `DB_NAME` must already exist. `DB_TRUST_SERVER_CERTIFICATE=true` is useful for local development with a self-signed certificate; use a trusted certificate in production.

The login uses the supplied `dbo.userlogin` schema: `User_Name`, `User_Password`, `Branch_Name`, and `Role`. After successful login the workspace overview opens; use the left navigation's **Tender & Bank Guarantee** item to open the form. Branch options are populated from distinct `Branch_Name` values in this table.

Set `AUTH_PASSWORD_FORMAT` to the representation in the password column:

- `bcrypt`: bcrypt hashes (recommended)
- `scrypt`: values stored as `scrypt$<base64-salt>$<base64-hash>`
- `plain`: legacy plain-text passwords only; the supplied table currently uses this mode, which is insecure and should be replaced with password hashes

Never put production credentials in source control. `.env` is excluded by `.gitignore`. Set `SESSION_SECRET` to a private, random string of at least 32 characters. To generate one in PowerShell:

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64'))"
```

If your organization stores passwords in another hash format, do not choose a different mode as a workaround: implement a verifier for that format before enabling sign-in.

The sign-in page uses the supplied Escon logo and a responsive two-panel layout. **Remember Me** stores only the username in this browser, never the password. **Forgot Password?** directs the user to contact their system administrator; password resets are not performed by the application.

## 4. Prepare the application tables

The application stores each submission in `dbo.TenderRecords` with an explicit nullable `NVARCHAR(MAX)` column for every Tender Details, Operation, Banking, and Approval business field, including `OperationRemarks`, as well as its JSON form snapshot, database-generated `RecordId`, and branch-based `UniqueId`. Operation Remarks can be entered in the Operation section and is included below the operation/payment details in generated PDFs. `ApprovalLoginName` and `ApprovalDateTime` are automatically captured on each save; the timestamp uses nullable `DATETIME2`. The schema also creates shared field, appearance, and role/tab access settings tables. Startup runs the idempotent schema script by default and adds any missing columns to an existing `TenderRecords` table. The SQL Server account therefore needs permission to create/alter the application tables.

Business values are stored as text to accept arbitrary values; blank form entries are stored as SQL `NULL`. Dates and amounts therefore remain text in their business columns, not native date/numeric types. The auto-captured Approval timestamp is a native SQL `DATETIME2`.

Alternatively, run [`sql/schema.sql`](./sql/schema.sql) in SQL Server Management Studio using an account with table-creation/alter permission, then set `AUTO_CREATE_SCHEMA=false` in `.env`. The application account needs read/write access to the tender and settings tables.

The app does not create or modify `dbo.userlogin`.

## 5. Configure fields in the application

Sign in with an account whose `Role` is `admin`. Open **Field Settings** from the left navigation. Administrators can add fields, change a field's tab and category, edit labels, choose **Open box (text)**, **Number**, **Dropdown**, **Date**, or **Long text**, and configure dropdown suggestions. Adding or deleting fields saves immediately; use **Save field settings** to publish edits. Saved changes are pushed to open Tender forms, and custom fields remain available after reload. Every business field is optional and accepts free-form text regardless of the configured display type; date, number, IFSC, and dropdown-format values are not rejected. The initial form uses the four workbook sections: **Tender Details**, **Operation**, **Banking**, and **Approval**. Workflow-managed fields cannot be deleted or moved out of their workflow section.

The **User and role access** panel lists every username, role, and branch from `dbo.userlogin`. Role defaults apply unless Admin enables **Customize** and sets an individual login's view/edit permissions. Admin accounts always retain full access; approver access remains assigned-record based. All accessible sections appear vertically on one continuous form page. **Operation** users create and see only records for their login branch; the saved Branch is taken from `dbo.userlogin`, not trusted from the submitted form. Only the designated Rahul and Amrita **Approver** accounts can approve or reject assigned requests; **Admin** accounts can approve or reject any pending request. **Banking** can see requests after approval, view Tender Details and Operation read-only, and edit Banking details. The server checks record scope and permitted updates; hiding fields in the browser alone does not grant or revoke access.

The matching Rahul and Amrita login records in the configured database have been assigned the `Approver` role; only those logins appear in **Assign To** and can review assigned requests. Admin accounts can approve or reject any pending request. A rejection returns the request to its originating branch for changes and resubmission. Approval routes it to Banking. Banking can update its fields and choose its own **Approve request** action; any unsaved Banking edits are saved before approval. Admin can also complete this Banking step. The approval identity and IST timestamp are stored in `ProcessedBy` and `ProcessedAt` for audit, but the branch summary displays only the Banking status. Summary updates live when other users update a request. Branch users can open and review request details for their branch but are not shown approval actions.

Approval, review, and processing timestamps are recorded as India Standard Time (IST). SQL `DATETIME2` workflow timestamp columns store the IST wall-clock value; the form's timestamp text includes the `IST` suffix. Summary update times are converted to IST for display.

Branch suggestions are configured in Field Settings. Operation users see their login branch, and the server sets the record's Branch from that login. A new record gets an ID consisting of the first three letters of the login branch, uppercased, followed by its global identity row number padded to at least six digits (for example, `NOR000042`); when the login branch is blank or has no letters, the prefix is `XXX`.

Field definitions and settings are stored in `dbo.TenderFieldSettings`, login-page colors in `dbo.TenderAppearanceSettings`, role permissions in `dbo.TenderTabAccessSettings`, and per-login overrides in `dbo.TenderUserAccessSettings`. Startup creates or migrates these settings tables. Administrators can add up to 150 fields and delete fields from the active form. Deleted fields remain in historical records and are not rewritten. Workflow assignment, reviewer status, banking job status, and audit information are stored in dedicated nullable columns on `dbo.TenderRecords`.

The **Login page colors** section lets admins choose background colors, button/accent colors, headline highlight, card background and card text using a color picker or hex value. Changes preview as you edit. Select **Save login colors** to persist and immediately publish the palette to open login pages. The sign-in page adjusts overly dark backgrounds and overly light cards to retain readable contrast. Use **Restore default colors** to preview the default palette before saving it.

## 6. Configure initial dropdown choices

Edit [`config/dropdown-options.json`](./config/dropdown-options.json). Add each dropdown choice as a string in its array, for example:

```json
{
  "branch": ["North", "South"],
  "department": ["Projects", "Service"],
  "referenceType": ["NIT Ref No", "LOA No", "WorkOrder No"],
  "workType": ["Installation", "Modernization"],
  "jobType": ["Installation", "Maintenance", "Tender"],
  "tenderType": ["Open", "Limited"],
  "requisitionType": [
    "Tender Fees",
    "Processing Fees",
    "Legal & Stationary Charges",
    "Stamp Duty Charges",
    "EMD",
    "PBG",
    "Additional BG",
    "Advanced BG",
    "Extention BG",
    "FDR Renewal"
  ],
  "emdConvertedToSd": ["Yes", "No"],
  "refundable": ["Yes", "No"],
  "paymentTerm": ["As per contract"],
  "preparedBy": ["Accounts", "Projects"]
}
```

The example choices above are illustrative; replace them with values approved for your organization. An empty list is intentionally used when the correct business values are not known. The initial choices are used until an administrator saves field settings in the application. Branch values are only those configured here or in Field Settings; they are not imported from the login table.

## 7. Start the app

```powershell
npm.cmd start
```

For development with automatic server restarts:

```powershell
npm.cmd run dev
```

Open <http://localhost:3000> in a browser and sign in with an account present in `dbo.userlogin`.

- The **Overview** page shows submitted, approved, not-approved, and pending totals with a status chart. Approved means the Banking step is complete; a reviewer-approved request still awaiting Banking remains Pending. Counts are scoped to the same records visible to the signed-in account and refresh when a request changes.
- The login named `banking` may retain the `Approver` role in `dbo.userlogin`; that specific account also receives the Banking queue and Banking-field edit/final-approval access. Its **Job Status** dropdown is editable, while choosing **Processed** is recorded through **Approve request** so the final action and timestamp are audited. Other Approver accounts do not receive Banking access.
- An **Operation** user creates a record from **Tender & Bank Guarantee**, completes Tender Details and Operation, chooses an **Assign To** reviewer, then selects **Save tender record**. The application generates the unique ID when saving.
- The assigned **Approver** opens the request from **Summary** and chooses **Approve request** or **Not approved**. Other approver accounts cannot open that request.
- Assigned **Approver** and **Admin** accounts can choose **Save PDF** in Summary to download a form-style PDF containing that record's Tender Details and Operation fields. The reviewer who approved and review timestamp appear compactly in the first-page header; Created By and Branch appear at the bottom. Payment Term appears near the end, followed by a labeled, empty Additional Remark box. Access is checked on the server against the record assignment; Banking and unrelated reviewer accounts cannot download it.
- **Download Excel** in Summary exports all records for the signed-in branch, all records assigned to a signed-in Approver, or all branches for Banking and Admin. The workbook includes record/workflow metadata and fields visible to that login; Admin can edit every configurable business field by opening a record.
- Banking and Admin can choose **Reject request** for an eligible queued request. Banking can reject requests approved and awaiting Banking action; Admin can reject pending reviewer requests or requests awaiting Banking action. Rejected requests are marked **Not Approved**, recorded with the rejecting login and IST timestamp, and removed from the Banking queue; originating branches can edit and resubmit them.
- A **Banking** user opens an approved request from **Summary**, enters Banking details, and selects the Banking **Approve request** action. Any unsaved field edits are saved before the approval is recorded. Admin can perform this final Banking action as well.
- **Summary** lists submitted records by unique ID and provides an expandable view of every field the signed-in role is allowed to see. Selecting **Open** opens the role-filtered record form.
- An **Admin** user can see and edit all four tabs, approve or reject any pending request, complete the Banking step for an approved request, change fields and tab access, and manage dropdown choices.

The ID uses the login branch for Operation-created records. Dropdown choices are suggestions only; custom text is accepted for ordinary form fields.

Run the automated checks with:

```powershell
npm.cmd test
```

## Form fields

The separate **LO Number** field is followed by **Type Of Reference**, **Reference No**, and **Reference Date**. Selecting **NIT Ref No**, **LOA No**, or **WorkOrder No** updates the reference number and date labels to match that reference type. These are the initial dropdown choices and can be changed in Field Settings.

The **Job Type** dropdown initially contains **Installation**, **Maintenance**, and **Tender**. In Field Settings, edit the Job Type dropdown choices to manage the options. The label behavior is in [`public/reference-labels.js`](./public/reference-labels.js): Installation displays **CH Date** / **MH Date**, Maintenance displays **Maintenance period From** / **Maintenance period to**, and Tender (or any other option) restores the configured Start Date / End Date labels. To change this behavior yourself, edit the corresponding `getJobTypeDateLabels` cases, then run `npm.cmd test`; restart the app if you changed initial dropdown options in `config/dropdown-options.json`.

The **Type Of Requisition** dropdown initially contains Tender Fees, Processing Fees, Legal & Stationary Charges, Stamp Duty Charges, EMD, PBG, Additional BG, Advanced BG, Extention BG, and FDR Renewal. Only the first nine listed choices change the Amount, In Form of, and in favor of labels. FDR Renewal and other choices retain the configured labels. **Valid Upto** remains visible with its configured label for every choice. Manage dropdown choices in Field Settings; to modify label behavior yourself, edit `getRequisitionLabels` in [`public/reference-labels.js`](./public/reference-labels.js), then run `npm.cmd test`.

All business fields may be left blank; blank values are stored as SQL `NULL` in their explicit columns. Fields configured as dates use the browser's native calendar picker and include a **Clear date** button. Numeric, IFSC, and dropdown-configured fields remain free-form; dropdown choices are suggestions only. Date values are stored as text, and the Approval save timestamp is stored as `DATETIME2`.

## Notes for deployment

The app uses secure HTTP-only, same-site session cookies, CSRF tokens, sign-in rate limiting, and parameterized SQL values. For production, serve it over HTTPS, set `NODE_ENV=production`, use a long private `SESSION_SECRET`, use bcrypt/scrypt password hashes, assign a least-privilege SQL account, and configure a persistent Express session store instead of the built-in in-memory store.
