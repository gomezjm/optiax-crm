# **Product Requirements Document: LatAm WhatsApp CRM & AI Agent**

**Target Audience:** Small businesses in Latin America interacting primarily via WhatsApp.  
**Core Concept:** A lightweight, scalable SaaS CRM with an integrated WhatsApp AI agent to automate customer capture, order logging, and basic marketing, designed specifically for conversational commerce.

## **Strategic Architecture Note: WhatsApp Coexistence**

The system will utilize WhatsApp's **"Coexistence"** capability for the MVP phase. This allows the business owner to continue using their native WhatsApp Business App to monitor chats, read messages, and intervene manually, eliminating the immediate need to design and develop a custom Unified Inbox within the CRM.

## **Screen 0: Dashboard (Home Screen)**

A simple, motivational snapshot of daily operations.

* **Today's Sales:** Total revenue generated today (in local currency).  
* **Pending Orders:** Count of orders awaiting processing or delivery.  
* **Action Needed:** Flagged chats/orders requiring human intervention (e.g., payment verification).  
* **Active Campaigns:** Quick view of currently running broadcast campaigns.

## **Screen 1: Customers**

Directory of all captured and imported leads/customers.

| Feature | Description |
| :---- | :---- |
| Auto-Creation | Customers are automatically created and populated by the active WhatsApp agent. |
| Manual Creation | Ability to manually add a customer profile. |
| Pre-set Attributes | Togglable fixed attributes (e.g., Birthday, Preferred Payment Method, Delivery Neighborhood) to avoid database clutter. Core fields: Name, Address, Phone, Email, Gender, City, Age Group. |
| Automated Attributes | System-generated metrics: Last Order Date, Last Message Sent, Total Spent. |
| Consent Status | Visual indicator of WhatsApp opt-in status (required for API compliance). |
| Visual Tags/Labels | Color-coded tags (e.g., "VIP", "Wholesale") for quick identification. |
| Conversation Link | Deep link to open the specific chat thread in the native WhatsApp application. |
| Mass Edit | Ability to select multiple customers to update tags or attributes simultaneously. |
| Filters | Robust filtering by attributes, tags, and automated metrics. |

## **Screen 2: Customer Segments**

Dynamic grouping of customers for targeted actions.

| Feature | Description |
| :---- | :---- |
| Dynamic Rule Creation | Create segments based on conditions (e.g., Last order \> X days, Avg order size \= X, Age group \= Y). Segment lists update automatically. |
| Pre-built Templates | Default segments for quick use (e.g., *At Risk*, *VIPs*, *Window Shoppers*). |
| Segment View | List view displaying all customers currently falling into a selected segment. |

## **Screen 3: Campaigns**

Outbound messaging and automation.

| Feature | Description |
| :---- | :---- |
| Targeted Broadcasts | Send messages to specific customer segments with defined start/end times. |
| WhatsApp Template Manager | Interface to submit, manage, and select Meta-approved message templates for outbound campaigns. |
| Auto-Replies | General automated replies (independent of specific campaigns) triggered by predefined logic. |
| Basic ROI Metrics | Tracking metrics for campaigns: Sent, Read, Orders Generated, Revenue Generated. |

## **Screen 4: Orders**

Order management and payment tracking.

| Feature | Description |
| :---- | :---- |
| Auto-Capture | Agent automatically parses conversation and creates an order record. |
| Manual Creation | Ability for the business owner to manually log an order. |
| Order Status Management | Change status dynamically (e.g., New, Awaiting Payment, Processing, Shipped). |
| Payment Proof Flag | Status specifically for "Receipt Uploaded \- Awaiting Manual Verification". |
| Payment Reference Number | Dedicated field to store transaction IDs (auto-extracted via OCR/agent or manually entered). |
| Logistics Fields | Dedicated fields for delivery address, delivery date, and driver notes. |
| Quick Export | Export daily orders to PDF/CSV for delivery routing (moto/Rappi handoff). |

## **Screen 5: WhatsApp Agent Configuration**

Control center for the AI's behavior.

| Feature | Description |
| :---- | :---- |
| Master Toggle | Activate or deactivate the AI agent globally. |
| System Prompt Editor | Define company name, agent persona/tone, and core instructions. |
| FAQ Builder | Inject standard answers to common questions into the agent's knowledge base. |
| Human Handoff Control | Ability to pause the agent for a specific customer (e.g., 24-hour mute) to allow manual intervention without bot interference. |
| Audio Message Rules | Define how the bot handles voice notes (e.g., utilize Speech-to-Text OR reply with standard text request). |
| Operating Hours | Schedule when the agent is active (e.g., 24/7 or outside business hours only). |

## **Screen 6: Products & Prices**

Lightweight catalog for agent consultation.

| Feature | Description |
| :---- | :---- |
| Product Management | Create products, set base prices, and edit names. The AI agent constantly queries this. |
| Availability Toggle | Mark items as "Unavailable/Out of Stock" to prevent the agent from selling them. |
| Images | Upload 1-2 images per product for the agent to use in chats. |
| Categories | Simple grouping (e.g., "Shirts", "Shoes") for easier AI navigation and customer queries. |
| Promotional Pricing | Field to set a discounted price (displays as struck-through original price in logic). |

## **Screen 7: Configuration (Settings)**

System-wide defaults and integrations.

| Feature | Description |
| :---- | :---- |
| Client Attributes Master | Manage which pre-set attributes are active/visible in Screen 1\. |
| Order Status Master | Define and customize the steps in the order pipeline. |
| Payment Methods Master | Define accepted bank accounts/digital wallets for the agent to share. |
| WhatsApp API Setup | Secure area to input Meta API tokens and webhook configurations. |
| Massive Upload | CSV import tool for migrating existing customer databases. |
| Team Access | Role management (Admin vs. Sales Rep permissions). |

