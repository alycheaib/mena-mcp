// Starter policy templates (original text). Edit to match how the organisation really works; auditors test practice, not prose.
const header = (title, org, owner, controls) => `# ${title}

| | |
|---|---|
| Organisation | ${org} |
| Owner | ${owner} |
| Version | 1.0 |
| Approved by / date | ____________ |
| Review | At least yearly |
| Maps to | ${controls} |

`;

const T = {
  information_security: {
    title: 'Information Security Policy', controls: 'SOC 2 CC1.1, CC5.3 · ISO 27001 5.1, 5.2, 5.4 · GDPR Art. 24, 32',
    body: (o) => `## 1. Purpose
${o} protects the confidentiality, integrity and availability of its information and of the personal data entrusted to it.

## 2. Scope
All employees, contractors, systems, cloud services and data that ${o} owns or processes.

## 3. Principles
- Access is granted on least privilege and need-to-know, with MFA on every system that supports it.
- Data is classified (Public, Internal, Confidential, Restricted) and protected by its class.
- Data is encrypted in transit (TLS 1.2+) and at rest.
- Security is built into projects and software from the design stage.
- Risks are assessed at least yearly and treated according to the risk register.
- Incidents are reported immediately to the security owner.

## 4. Roles
- **Management**: approves this policy, provides resources and reviews performance yearly.
- **Security owner**: maintains the ISMS/control set, the risk register and the incident process.
- **All staff**: follow the policies, complete yearly training and report incidents.

## 5. Supporting policies
Acceptable Use, Access Control, Incident Response, Business Continuity, Vendor Management, Data Retention, Secure Development.

## 6. Compliance
Breaches of this policy may lead to disciplinary action. Exceptions need a documented risk acceptance by the security owner.
` },
  access_control: {
    title: 'Access Control Policy', controls: 'SOC 2 CC6.1–CC6.3 · ISO 27001 5.15–5.18, 8.2, 8.3, 8.5 · GDPR Art. 32',
    body: (o) => `## 1. Rules
1. Every person has a unique account, with no shared accounts. Service accounts have a named owner.
2. SSO and MFA are mandatory for email, cloud consoles, source code, production and admin tools.
3. Access is role-based and approved by the system owner before it is granted (ticket required).
4. Privileged (admin) access is limited, separate from daily accounts and logged.
5. **Joiners**: access is created from the approved role. **Movers**: old access is removed within 5 working days. **Leavers**: all access is revoked within 24 hours.
6. Access reviews: system owners review user and admin access **quarterly** and record the result.
7. Passwords: at least 12 characters or passphrases, stored in the company password manager, never reused.

## 2. Evidence kept
IdP MFA settings, access request tickets, quarterly review sign-offs and offboarding checklists.

_${o} security owner is responsible for this policy._
` },
  incident_response: {
    title: 'Incident Response Policy & Plan', controls: 'SOC 2 CC7.3–CC7.5 · ISO 27001 5.24–5.28, 6.8 · GDPR Art. 33, 34',
    body: (o) => `## 1. Report
Anyone who suspects an incident reports it **immediately** to the security owner through the incident channel.

## 2. Severity
- **SEV1**: confirmed data breach, production outage or ransomware.
- **SEV2**: contained compromise, or suspected personal-data exposure.
- **SEV3**: policy violation or low-impact event.

## 3. Steps
1. **Triage**: assign an incident lead, open an incident record and start a timeline.
2. **Contain**: isolate systems, revoke credentials and preserve evidence (logs, images).
3. **Assess personal data**: if personal data may be affected, the privacy lead assesses the risk to individuals **at once**.
4. **Notify**: if a breach is likely to risk individuals, notify the supervisory authority **within 72 hours of becoming aware** (GDPR Art. 33). Notify affected people without undue delay if the risk is high (Art. 34). Notify customers as the contracts require.
5. **Eradicate & recover**: remove the cause, restore from clean backups and monitor.
6. **Lessons learned**: hold a post-incident review within 10 working days and track the actions to closure.

## 4. Records
Every incident and breach is logged (facts, effects, actions), including those not notified (Art. 33(5)).

## 5. Testing
${o} runs a tabletop exercise at least yearly.
` },
  business_continuity: {
    title: 'Business Continuity & Backup Policy', controls: 'SOC 2 CC9.1, A1.2, A1.3 · ISO 27001 5.29, 5.30, 8.13, 8.14',
    body: (o) => `## 1. Objectives
Critical services and their RTO (maximum downtime) and RPO (maximum data loss) are listed in the BCP register.

## 2. Backups
- Automated, encrypted and stored in a separate account or region.
- Retention: daily for 35 days and monthly for 12 months (adjust to the retention schedule).
- A **restore is tested every quarter** and the result is recorded.

## 3. Disaster recovery
Documented runbooks for each critical service. The DR test runs **yearly** and the gaps are tracked.

## 4. Roles
${o} management declares a disaster; the technical lead coordinates recovery; communications are handled by the named owner.
` },
  vendor_management: {
    title: 'Vendor & Supplier Security Policy', controls: 'SOC 2 CC9.2 · ISO 27001 5.19–5.23 · GDPR Art. 28, 44-49',
    body: (o) => `1. Every vendor is recorded in the vendor inventory, with an owner, the data it accesses and a risk tier.
2. **High-risk vendors** (those that access Confidential/personal data or production) must provide a SOC 2 Type II report, an ISO 27001 certificate or a completed security questionnaire before onboarding.
3. Contracts include security, confidentiality, breach notification and audit terms. Processors of personal data sign a **DPA** (Art. 28), with **SCCs** or another transfer tool for transfers outside the EEA.
4. High-risk vendors are reviewed **yearly**; access is removed when the contract ends.

_${o} keeps this inventory current._
` },
  data_retention: {
    title: 'Data Retention & Deletion Policy', controls: 'SOC 2 C1.2, P4.2, P4.3 · ISO 27001 5.33, 8.10 · GDPR Art. 5(1)(e), 17',
    body: (o) => `| Data | Retention | Then |
|---|---|---|
| Customer account data | Contract + 30 days | Delete or anonymise |
| Invoices & accounting records | As required by tax law (e.g. 5–10 years) | Delete |
| Job applicant data | 6 months after the decision | Delete unless consent to keep |
| System & security logs | 12 months | Delete |
| Backups | Per the backup policy | Expire automatically |
| Marketing contacts | Until consent is withdrawn or 24 months inactive | Delete |

Deletion is automated where possible and logged. Personal data is masked in non-production environments. Erasure requests (Art. 17) are handled by the DSAR procedure.

_Adjust this table to ${o}'s real data and legal obligations._
` },
  privacy_notice: {
    title: 'Privacy Notice (website/app)', controls: 'GDPR Art. 12–14 · SOC 2 P1.1',
    body: (o) => `**Who we are.** ${o} is the controller of your personal data. Contact: [privacy email]. [DPO / EU representative if appointed.]

**What we collect and why.**
| Purpose | Data | Lawful basis | Retention |
|---|---|---|---|
| Provide the service | Account, usage data | Contract (Art. 6(1)(b)) | Contract + 30 days |
| Billing | Name, billing details | Legal obligation (6(1)(c)) | As required by tax law |
| Security & fraud prevention | Logs, IP addresses | Legitimate interests (6(1)(f)) | 12 months |
| Marketing emails | Email | Consent (6(1)(a)) | Until withdrawn |

**Who we share it with.** Hosting, email and payment processors under data processing agreements. [List the categories or names.]

**International transfers.** Where data leaves the EEA we use adequacy decisions or Standard Contractual Clauses.

**Your rights.** You can request access, rectification, erasure, restriction or portability, and you can object to processing or withdraw consent at any time. We respond within one month. You may complain to your data protection authority.

**Updates.** Last updated: [date].
` }
};

export const POLICY_KEYS = Object.keys(T);

export function policyTemplate({ policy, organisation = '[Organisation]', owner = '[Security owner]' }) {
  const t = T[policy];
  if (!t) throw new Error(`Unknown policy. Available: ${POLICY_KEYS.join(', ')}`);
  return { policy, title: t.title, maps_to: t.controls, markdown: header(t.title, organisation, owner, t.controls) + t.body(organisation) };
}
