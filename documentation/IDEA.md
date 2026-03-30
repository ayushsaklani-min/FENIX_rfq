# SEALrfq IDEA

## Confidential procurement infrastructure for the real economy

### Executive thesis

Public procurement is one of the largest markets in the world, but it still runs on systems that force a bad trade-off between transparency and commercial privacy. SEALrfq removes that trade-off by combining **FHE-enabled smart contracts**, **verifiable workflow execution**, and **audit-grade event trails**.

Our core proposition is simple:

- Keep bids private while competition is active.
- Keep process and settlement fully verifiable.
- Reduce leakage, collusion risk, and trust friction for buyers and suppliers.

---

## The problem we are solving

### 1) Procurement is massive, but still structurally inefficient

World Bank benchmarking work describes public procurement as accounting for **around one-fifth of global GDP**. With World Bank WDI reporting global GDP at **~$110.98T in 2024**, that implies a procurement flow on the order of **~$22.2T/year** globally.

This is a huge market with high impact sensitivity: small improvements in fairness, cycle time, and cost leakage create material macro value.

### 2) Current digital systems improve visibility, but not confidentiality

Most e-procurement systems prioritize publication and traceability, but price disclosure during active competition creates problems:

- Margin exposure for suppliers.
- Strategic underbidding or collusion behavior.
- Lower participation from serious vendors in sensitive categories.
- Reduced trust in high-value tenders.

World Bank procurement diagnostics also highlight broad market friction:

- In measured economies, timely supplier payment is not universal; delays can be severe.
- Information asymmetry still exists where e-procurement coverage is limited or fragmented.

### 3) Why privacy is necessary in anti-corruption procurement design

Procurement corruption is not only a transparency failure; it is often a **market-manipulation problem**. Reputable sources consistently show the scale and mechanisms:

- **World Bank working research** identifies public procurement as a prime corruption target because contract values are large and process points are numerous.  
- **Transparency International** highlights that procurement corruption can involve bid rigging, favoritism, and inflated prices, and reports cases where corruption has added up to **50%** to project costs.
- **Open Contracting Partnership** estimates global public contracting at around **$13T annually**, with only a small fraction openly published in structured form, indicating large oversight blind spots.

In practice, corruption risk in procurement usually appears in two zones:

1. **Pre-award manipulation** (information leakage, steering, collusion)  
2. **Post-award abuse** (price inflation, scope manipulation, weak enforcement)

Conventional “fully public bid visibility” helps some oversight goals, but it can also expose sensitive commercial data too early, enabling strategic behavior among competitors. SEALrfq addresses this by combining:

- **confidential bid values during active competition**, and
- **verifiable workflow/audit evidence for governance and compliance**.

This creates a more balanced control model: protect legitimate commercial secrecy while preserving accountability signals needed to detect abuse.

### 4) SMEs are disproportionately penalized by trust and liquidity gaps

World Bank SME finance work estimates a **$5.7T financing gap** across 119 EMDEs. In procurement, delayed or uncertain payments, plus opaque award dynamics, create additional barriers for SMEs that already have limited cash-flow buffers.

**Bottom line:** procurement needs a trust model where competition remains confidential while settlement and compliance stay provable.

---

## Why now

### Privacy-in-use is becoming a mainstream infrastructure requirement

Google’s Confidential Computing materials frame a major shift: keep data protected **while it is being processed**, not only at rest or in transit. That same principle now needs to be applied to procurement logic and bid comparison.

SEALrfq operationalizes this principle on-chain:

- computation on encrypted values,
- verifiable contract execution,
- selective reveal only when policy requires it.

---

## SEALrfq solution

SEALrfq is a privacy-preserving procurement protocol stack with four product surfaces:

1. **Sealed RFQ lifecycle**
   - Buyers create RFQs.
   - Vendors submit encrypted bids.
   - Winner selection is verified without public bid leakage during live competition.

2. **Auction primitives**
   - Vickrey and Dutch formats with encrypted logic support.
   - Flexible procurement modes for different category dynamics.

3. **Confidential settlement**
   - Escrow, release, and invoice-linked payout flows integrated with confidential token mechanics.

4. **Audit and compliance traceability**
   - Immutable event records and transaction lifecycle tracking for auditors and operators.

### Product principle

**Process transparency, price confidentiality, deterministic settlement.**

---

## Why Fhenix

We chose Fhenix because it aligns with product requirements and team execution constraints:

- **FHE-native smart contract model** enables encrypted comparisons directly in contract logic.
- **EVM compatibility** allows us to use Solidity, wallet standards, and common tooling.
- **Confidential token support (FHERC20 model)** enables private-value escrow and payout patterns.
- **Migration practicality** lets us evolve from earlier stacks without rewriting the entire product model.

In short, Fhenix gives us privacy capabilities without sacrificing developer velocity or ecosystem interoperability.

---

## Who this is for

- **Procurement teams (public and enterprise):** confidential competition with stronger auditability.
- **Suppliers and SMEs:** reduced strategic exposure and clearer settlement trust.
- **Auditors and regulators:** immutable process evidence and role-based traceability.

---

## What success looks like

### Business outcomes

- Higher qualified vendor participation per tender.
- Reduced bid leakage and dispute incidence.
- Faster award-to-settlement cycle time.
- Improved supplier confidence in payment finality.

### Technical outcomes

- Stable encrypted bidding and winner-selection workflows.
- End-to-end deterministic transaction tracking.
- Clear separation between private commercial data and public compliance data.

---

## Source references

1. World Bank, *Benchmarking Public Procurement 2017* (public procurement around one-fifth of global GDP; procurement process and complaint system benchmarks).  
   URL: `http://documents.worldbank.org/curated/en/121001523554026106/Benchmarking-Public-Procurement-2017-Assessing-Public-Procurement-Regulatory-Systems-in-180-Economies`

2. World Bank Data API, indicator `NY.GDP.MKTP.CD` (World GDP current US$, 2024 value).  
   URL: `https://api.worldbank.org/v2/country/WLD/indicator/NY.GDP.MKTP.CD?format=json&mrv=1&per_page=1`

3. World Bank, SME Finance topic page (SME finance gap estimate).  
   URL: `https://www.worldbank.org/en/topic/smefinance`

4. Google Cloud, Confidential Computing overview (data-in-use protection and confidential collaboration framing).  
   URL: `https://cloud.google.com/confidential-computing`

5. World Bank document record, *Corruption and Technology in Public Procurement* (2007) and related text archive.  
   URL: `http://documents.worldbank.org/curated/en/946171468151791174/Corruption-and-technology-in-public-procurement`

6. Transparency International, public procurement corruption priority page (risk framing, cost inflation examples).  
   URL: `https://www.transparency.org/en/our-priorities/public-procurement`

7. Open Contracting Partnership, global procurement spend explainer (`$13T` estimate and publication gap framing).  
   URL: `https://www.open-contracting.org/what-is-open-contracting/global-procurement-spend/`

