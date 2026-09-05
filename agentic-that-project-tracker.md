# Agentic That Core Engine Tracker

## Project Tracker

```mermaid
kanban
  devTodo[Dev - To Do]
    dev1[Finalize DB and User Settings]
    dev2[Resume Scheduling After Validation]

  deploymentTodo[Deployment - To Do]
    dep1[Configure Supabase and Netlify]
    dep2[Run Database Migration]
    dep3[Re Pair Companion v2]
    dep4[Production Sign Off]

  inProgress[In Progress]
    prog1[Production Readiness]
    prog2[Companion v2.1 Signing and Live OS Validation]
    prog3[WhatsApp Final Validation]

  testing[Testing]
    test1[Publishing All Platforms]
    test2[Instagram and Facebook Scraping]
    test3[Companion Recovery and Reconnect]
    test4[RBAC and Invitation Flow]

  completed[Completed]
    done1[Companion v2 Windows]
    done2[Supabase Job Control]
    done3[Secure Pairing and Job Claiming]
    done4[Publishing Engines]
    done5[Instagram and Facebook Scraping]
    done6[Telegram Messaging]
    done7[WhatsApp Core Integration]
    done8[GitHub Actions Release Pipeline]
    done9[Extension Dependency Removed]
    done10[Invitation System]
    done11[Companion v2.1 Windows macOS Linux Builds]
    done12[Companion v2.1.2 Account Sync and Persistent X YouTube Sessions]
    done13[Companion v2.1.3 Legacy Session and Account Recovery]
    done14[Companion v2.1.5 Instagram Publishing and Scraping Compatibility]
    done15[Companion v2.1.6 Durable Facebook Session Recovery]
    done16[Companion v2.1.7 Public Facebook Discovery and Explicit YouTube Options]
    done17[Direct Resilient Media Uploads with Live Progress]
    done18[2 GB Publishing Media Uploads]
    done19[Duplicate-safe Companion Login Status Sync]
    done20[Companion v2.1.8 Large Media Publishing]
    done21[Batched Resilient Supabase Media Uploads]
    done22[Isolated Timeout Safe Publishing Upload Sessions]
    done23[Companion v2.1.9 Publishing Confirmation and Facebook Discovery]
    done24[Companion v2.1.10 Testing Pace Without Posting Delays]
    done25[Resumable Idempotent Large Media Finalization]
    done26[Concurrent Multi User Publishing Workspace Stability]

  future[Future]
    future1[Android Companion]
    future2[iOS Companion]
    future3[Server Companion Optional]
```


# AgenticThat Architecture

```mermaid
flowchart TD

    U[User]

    W[AgenticThat Website<br/>Next.js + Netlify<br/><br/>Login • RBAC • Publishing • Scraping • Results]

    S[(Supabase<br/><br/>Users • Workspaces • RBAC<br/>Job Queue • Companion Status<br/>Results • Account Metadata)]

    C[AgenticThat Companion<br/><br/>Local Execution Engine<br/>Playwright • Sessions • Recovery]

    U --> W
    W -->|Create Job| S
    S -->|Send Job| C

    C --> PUB
    C --> SCR

    subgraph PUBLISHING["Publishing Flow"]
        PUB[Publishing Engine]
        MEDIA[Supabase Storage<br/>Images / Videos]
        PLAT[Instagram • Facebook • X<br/>LinkedIn • YouTube]

        PUB --> PLAT
        MEDIA -->|Secure Media| PUB
    end

    subgraph SCRAPING["Scraping Flow"]
        SCR[Scraping Engine]
        SOURCE[Instagram • Facebook]
        DATA[JSON • CSV • Table]

        SCR --> SOURCE
        SOURCE --> SCR
        SCR --> DATA
    end

    PUB -->|Publishing Status| S
    DATA -->|Scraping Results| S

    S -->|Status + Results| W
```

## Main Flow

```text
USER
  │
  ▼
WEBSITE
  │
  │ Creates Publishing / Scraping Job
  ▼
SUPABASE
  │
  │ Sends Job
  ▼
COMPANION
  │
  ├───────────────┐
  │               │
  ▼               ▼
PUBLISHING      SCRAPING
  │               │
  ▼               ▼
Social          Instagram
Platforms       Facebook
  │               │
  └───────┬───────┘
          │
          ▼
       SUPABASE
          │
          ▼
        WEBSITE
```
