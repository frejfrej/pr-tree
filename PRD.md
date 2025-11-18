# Product Requirements Document (PRD)
## Bitbucket Pull-Requests Tree

**Version:** 1.12.0
**Last Updated:** 2025-11-18
**Author:** François-Régis Jaunatre
**Status:** Active Development

---

## 1. Product Overview

### 1.1 Product Name
Bitbucket Pull-Requests Tree

### 1.2 Product Vision
A unified dashboard that transforms pull request management by visualizing the complete workflow context—combining Bitbucket PRs with Jira issue tracking, sprint planning, and team collaboration status in a single, auto-refreshing view.

### 1.3 Product Description
Bitbucket Pull-Requests Tree is a web-based dashboard application designed for development teams using Bitbucket for code review and Jira for project management. It provides a comprehensive, hierarchical view of pull requests with integrated Jira issue tracking, enabling teams to understand PR status, dependencies, conflicts, and workflow bottlenecks at a glance.

### 1.4 Product Type
Internal developer tool / Self-hosted web application

---

## 2. Problem Statement

### 2.1 Current Challenges
Development teams using Bitbucket and Jira face several workflow inefficiencies:

1. **Context Switching**: Developers must navigate between Bitbucket, Jira, and sprint boards to understand work status
2. **Lack of Visibility**: No unified view of PR relationships, dependencies, and merge conflicts
3. **Manual Tracking**: Teams manually track which PRs need attention, which are blocked, and which are ready for review
4. **Stale Information**: Static pages require manual refreshing to see updates
5. **Sprint Disconnection**: Difficult to see which PRs are associated with current sprint work
6. **Orphaned Work**: Issues marked "In Review" without corresponding PRs go unnoticed
7. **Review Bottlenecks**: Hard to identify where code reviews are blocked or delayed

### 2.2 Impact
- Reduced team productivity due to information fragmentation
- Delayed code reviews and merge operations
- Increased context-switching overhead
- Missed deadlines due to lack of workflow visibility
- Poor sprint planning due to unclear PR status

---

## 3. Target Users

### 3.1 Primary Users
- **Software Developers**: Need to track their PRs, see review status, and identify conflicts
- **Team Leads**: Monitor team progress, identify bottlenecks, and ensure sprint completion
- **Code Reviewers**: Find PRs requiring review and prioritize work

### 3.2 User Characteristics
- Familiar with Git, Bitbucket, and Jira workflows
- Work in agile/scrum teams with sprint-based planning
- Manage multiple repositories and projects simultaneously
- Need rapid access to PR and issue status throughout the workday

### 3.3 User Environment
- Desktop/laptop browsers (Chrome, Firefox, Edge, Safari)
- Corporate network access to Bitbucket and Jira instances
- Running Node.js application on localhost or internal server

---

## 4. Goals and Objectives

### 4.1 Business Goals
1. **Reduce context-switching time** by 50% through unified view
2. **Accelerate code review cycle** by improving visibility of review-ready PRs
3. **Improve sprint predictability** by tracking PR status against sprint goals
4. **Minimize merge conflicts** through early detection and visualization

### 4.2 User Goals
1. Quickly assess all PRs requiring their attention (as author or reviewer)
2. Understand PR relationships and dependencies
3. Identify and resolve merge conflicts proactively
4. Track sprint progress through associated PRs
5. Avoid redundant API calls and slow page loads

### 4.3 Technical Goals
1. Minimize API load on Bitbucket and Jira through intelligent caching
2. Provide real-time updates without manual page refresh
3. Maintain sub-2-second initial page load time
4. Support multiple projects with independent configurations

---

## 5. Functional Requirements

### 5.1 Core Features

#### F1: Multi-Project Management
**Priority:** P0 (Must Have)
**Description:** Support multiple independent project configurations with easy switching

**Requirements:**
- F1.1: Display project selector dropdown with all configured projects
- F1.2: Load project-specific PRs, repositories, and Jira settings
- F1.3: Persist selected project in URL for deep linking
- F1.4: Support project-specific Jira regex patterns for issue extraction

**Acceptance Criteria:**
- User can select any configured project from dropdown
- Project selection loads correct PRs and issues within 2 seconds
- URL updates to include selected project
- Reloading page preserves project selection

---

#### F2: Pull Request Visualization
**Priority:** P0 (Must Have)
**Description:** Display all pull requests with hierarchical relationships and status

**Requirements:**
- F2.1: List all PRs ordered by most recently updated (descending)
- F2.2: Display PR hierarchy showing branch relationships
- F2.3: Show PR status (open, approved, conflicts, etc.)
- F2.4: Display commit ahead/behind counts relative to destination branch
- F2.5: Show associated Jira issues with status badges
- F2.6: Indicate when PR requires sync with parent branch

**Acceptance Criteria:**
- PRs appear in chronological order by update time
- Parent-child PR relationships are visually evident
- Green badges show commits ahead, red badges show commits behind
- "SYNC" badge appears on PRs that are behind their parent
- Jira issue links are clickable and show status color-coding

---

#### F3: Jira Integration
**Priority:** P0 (Must Have)
**Description:** Extract and display Jira issue information from PR titles

**Requirements:**
- F3.1: Extract Jira issue keys from PR titles using configurable regex
- F3.2: Fetch issue details from Jira API (summary, status, priority)
- F3.3: Display issue status with color-coded badges
- F3.4: Show issue priority icons
- F3.5: Provide direct links to Jira issues
- F3.6: Detect orphaned issues (In Review status without PRs)

**Acceptance Criteria:**
- All Jira issue keys in PR titles are identified and linked
- Issue status badges match Jira workflow states
- Clicking issue link opens Jira in new tab
- Orphaned issues appear in separate section with warning styling

---

#### F4: Advanced Filtering
**Priority:** P0 (Must Have)
**Description:** Multi-criteria filtering to focus on relevant PRs

**Requirements:**
- F4.1: Filter by PR author
- F4.2: Filter by PR reviewer
- F4.3: Filter by sprint (based on associated Jira issues)
- F4.4: Filter by sync status (needs sync / up to date)
- F4.5: Filter by "ready for reviewer" status
- F4.6: Filter by Jira fixVersion
- F4.7: Support simultaneous multiple filters
- F4.8: Maintain filter state in URL parameters
- F4.9: Hierarchical filtering (preserve parent-child relationships)

**Acceptance Criteria:**
- Each filter shows "Show all" option plus all available values
- Applying filters hides non-matching PRs instantly
- Filtered counters update to show X of Y PRs visible
- URL updates with all filter selections
- Sharing URL restores all filters (except SYNC and ready-for-reviewer)
- PRs highlighted in red when action required from filtered user
- Parent PRs remain visible if any children match filter

---

#### F5: Smart Auto-Refresh
**Priority:** P1 (Should Have)
**Description:** Automatic data updates without full page reload

**Requirements:**
- F5.1: Check for data updates every 2 minutes
- F5.2: Only re-render UI if data has changed (hash-based detection)
- F5.3: Show loading indicator during update check
- F5.4: Display last refresh timestamp
- F5.5: Pause updates when tab is inactive
- F5.6: Trigger refresh when tab becomes active
- F5.7: Prevent concurrent update checks

**Acceptance Criteria:**
- Page automatically updates every 2 minutes when active
- No visible UI update if data unchanged
- Refresh timestamp updates in real-time
- Loading spinner appears during checks
- No updates occur when tab in background
- Selecting tab triggers immediate update check

---

#### F6: Conflict Detection
**Priority:** P1 (Should Have)
**Description:** Identify and display merge conflicts

**Requirements:**
- F6.1: Check each PR for merge conflicts with destination branch
- F6.2: Display conflict count in badge on PR
- F6.3: Cache conflict status to reduce API load
- F6.4: Update conflict status on each refresh

**Acceptance Criteria:**
- PRs with conflicts show red badge with count
- Hovering badge shows conflict details
- Conflict checks complete within 5 seconds for all PRs

---

#### F7: Preview Popovers
**Priority:** P2 (Nice to Have)
**Description:** Show PR and issue details on hover

**Requirements:**
- F7.1: Display PR title and description in popover on hover
- F7.2: Display Jira issue summary and description on hover
- F7.3: Format markdown content appropriately
- F7.4: Show popovers with minimal delay (<500ms)

**Acceptance Criteria:**
- Hovering PR title shows popover with description
- Hovering issue key shows popover with issue details
- Popover appears within 500ms of hover
- Popover disappears when mouse leaves

---

#### F8: Sprint Integration
**Priority:** P1 (Should Have)
**Description:** Associate PRs with active sprints

**Requirements:**
- F8.1: Fetch all active sprints from Jira boards
- F8.2: Identify issues assigned to each sprint
- F8.3: Associate PRs with sprints via linked issues
- F8.4: Provide sprint filter dropdown
- F8.5: Cache sprint data (10-minute TTL)

**Acceptance Criteria:**
- Sprint filter populated with all active sprints
- Selecting sprint shows only PRs with issues in that sprint
- Sprint data refreshes every 10 minutes
- PRs without sprint association hidden when sprint filter active

---

#### F9: Online Help
**Priority:** P2 (Nice to Have)
**Description:** In-app documentation

**Requirements:**
- F9.1: Display README.md content in modal overlay
- F9.2: Render markdown with proper formatting
- F9.3: Provide help button in header
- F9.4: Close help with X button or outside click

**Acceptance Criteria:**
- Clicking "?" icon opens help modal
- Help content matches README.md
- Modal scrollable for long content
- Clicking outside modal closes it

---

### 5.2 Feature Priority Matrix

| Feature | Priority | Release |
|---------|----------|---------|
| Multi-Project Management | P0 | v1.1 |
| Pull Request Visualization | P0 | v1.0 |
| Jira Integration | P0 | v1.0 |
| Author/Reviewer Filtering | P0 | v1.0 |
| Smart Auto-Refresh | P1 | v1.3 |
| Sprint Integration | P1 | v1.6 |
| Conflict Detection | P1 | v1.5 |
| Sync Status Indicator | P1 | v1.7 |
| fixVersion Filtering | P1 | v1.12 |
| URL Filter Persistence | P1 | v1.6.2 |
| Preview Popovers | P2 | v1.6 |
| Online Help | P2 | v1.6 |
| Orphaned Issues Detection | P1 | v1.10 |
| Server-Side Caching | P0 | v1.11 |

---

## 6. Non-Functional Requirements

### 6.1 Performance
- **NFR-P1**: Initial page load must complete within 2 seconds on standard developer workstation
- **NFR-P2**: Filter operations must complete within 200ms
- **NFR-P3**: Auto-refresh checks must complete within 1 second when data unchanged
- **NFR-P4**: Server-side cache must reduce API call frequency by 80%
- **NFR-P5**: Support up to 500 concurrent pull requests without performance degradation

### 6.2 Reliability
- **NFR-R1**: Application must handle API failures gracefully with error messages
- **NFR-R2**: Cache must persist for configured TTL without premature expiration
- **NFR-R3**: Application must not crash on malformed API responses
- **NFR-R4**: Logs must capture all errors for debugging

### 6.3 Usability
- **NFR-U1**: User must be able to apply any filter within 2 clicks
- **NFR-U2**: Visual feedback required for all user actions within 100ms
- **NFR-U3**: Color-coding must be consistent across all status indicators
- **NFR-U4**: UI must remain responsive during background data fetching

### 6.4 Scalability
- **NFR-S1**: Support up to 50 repositories per project
- **NFR-S2**: Support up to 10 concurrent users on single server instance
- **NFR-S3**: Cache must handle up to 10,000 cached entries efficiently

### 6.5 Security
- **NFR-SEC1**: API credentials must never be exposed to client browser
- **NFR-SEC2**: Configuration file with credentials must be git-ignored
- **NFR-SEC3**: Application must use HTTPS when deployed outside localhost
- **NFR-SEC4**: No sensitive data logged to access/error logs

### 6.6 Maintainability
- **NFR-M1**: Code must follow consistent naming conventions (camelCase)
- **NFR-M2**: All API endpoints must have error handling with logging
- **NFR-M3**: Configuration must be externalized from code
- **NFR-M4**: Adding new project must not require code changes

### 6.7 Compatibility
- **NFR-C1**: Support Chrome, Firefox, Edge, Safari (latest 2 versions)
- **NFR-C2**: Require Node.js 16+ for server runtime
- **NFR-C3**: Compatible with Bitbucket API v2.0
- **NFR-C4**: Compatible with Jira API v3 and Agile API v1.0

---

## 7. Technical Requirements

### 7.1 Architecture
**Pattern:** Client-server with RESTful API

**Components:**
1. **Express Server** (index.mjs)
   - API endpoint routing
   - Bitbucket/Jira API integration
   - Server-side caching layer
   - Static file serving
   - Logging infrastructure

2. **Cache Layer** (cache.mjs)
   - In-memory caching with node-cache
   - Configurable TTL per data type
   - Cache statistics endpoint

3. **Frontend** (public/)
   - Single-page application (vanilla JS)
   - State management in app.js
   - Filtering logic in app-filter.js
   - Counter utilities in counter-utils.js

### 7.2 Technology Stack

#### Backend
- **Runtime:** Node.js (ES Modules)
- **Framework:** Express.js v4.19.2
- **HTTP Client:** node-fetch v3.3.2
- **Caching:** node-cache v5.1.2
- **Configuration:** dotenv v16.4.5

#### Frontend
- **Core:** HTML5, CSS3, Vanilla JavaScript (ES6)
- **Icons:** Font Awesome 5.15.3
- **Markdown:** Marked.js

#### External APIs
- Bitbucket API v2.0 (REST)
- Jira API v3 (REST)
- Jira Agile API v1.0 (REST)

### 7.3 Data Model

#### Project Configuration
```javascript
{
  projectName: {
    repositories: ['repo-slug-1', 'repo-slug-2'],
    jiraProjects: ['PROJ1', 'PROJ2'],
    jiraRegex: /(PROJ1-\d+|PROJ2-\d+)/g
  }
}
```

#### API Response Structure
```javascript
{
  lastRefreshTime: "ISO-8601 timestamp",
  pullRequests: [/* PR objects */],
  jiraIssuesMap: {/* PR ID -> Issue Keys */},
  jiraIssuesDetails: [/* Full issue objects */],
  pullRequestsByDestination: {/* Branch -> PRs */},
  jiraSiteName: "string",
  sprints: [/* Active sprint objects */],
  sprintIssues: {/* Sprint ID -> Issue Keys */},
  orphanedIssues: [/* Issues without PRs */],
  dataHash: "MD5 hash"
}
```

### 7.4 Caching Strategy

**Cache TTLs:**
- Project data: 120 seconds
- Projects list: 300 seconds
- Conflicts: 300 seconds
- Sprints: 600 seconds

**Hash-Based Change Detection:**
- Compute MD5 hash of PR + Jira data
- Only fetch commit counts when hash changes
- Prevents Bitbucket API rate limiting (HTTP 429)

### 7.5 API Endpoints

| Endpoint | Method | Cache TTL | Description |
|----------|--------|-----------|-------------|
| `/api/version` | GET | None | Application version metadata |
| `/api/projects` | GET | 300s | List of configured projects |
| `/api/pull-requests/:project` | GET | 120s | Comprehensive project data |
| `/api/pull-request-conflicts/:repo/:spec` | GET | 300s | Merge conflict detection |
| `/api/cache/stats` | GET | None | Cache performance statistics |

### 7.6 Logging Infrastructure

**Log Files:**
- `access.log`: Request logs (timestamp, method, path, IP)
- `error.log`: Error messages and stack traces
- `performance.log`: Operation duration metrics

**Log Format:**
```
[YYYY-MM-DD HH:mm:ss] Message
```

---

## 8. User Interface Requirements

### 8.1 Layout Structure
```
+--------------------------------------------------+
| Header: Project Selector | Help | Last Refresh  |
+--------------------------------------------------+
| Filters: Author | Reviewer | Sprint | Sync |... |
+--------------------------------------------------+
| Pull Requests (Hierarchical Tree View)           |
|   Repository 1                        [X / Y]    |
|     Branch A                          [X / Y]    |
|       PR #1 [SYNC] [Ahead:3] [Behind:1]          |
|         JIRA-123 [In Progress]                   |
|       PR #2 [Conflicts:5]                        |
|     Branch B                          [X / Y]    |
|       PR #3 [Ahead:2]                            |
+--------------------------------------------------+
| Orphaned Issues                                   |
|   JIRA-456 [In Review] - Issue Summary           |
+--------------------------------------------------+
| Footer: Version | GitHub Link                     |
+--------------------------------------------------+
```

### 8.2 Visual Design Requirements

#### Color Coding
- **Green**: Commits ahead, positive status
- **Red**: Commits behind, action required, conflicts, blocking issues
- **Blue**: Informational badges (SYNC, review status)
- **Yellow**: Priority indicators
- **Gray**: Neutral/inactive state

#### Status Badges
- Rounded corners with 4px radius
- Consistent padding (4px horizontal, 2px vertical)
- Font size: 12px
- Badges clustered on same line

#### Hierarchy Indicators
- Indentation: 20px per level
- Connection lines for parent-child relationships
- Collapsible sections for repositories/branches

### 8.3 Responsive Behavior
- Minimum width: 1024px (desktop-focused)
- Scrollable main content area
- Fixed header and filter bar
- Modal overlays for help content

### 8.4 Interactive Elements

**Filter Dropdowns:**
- Show all options alphabetically
- "Show all" as first option
- Highlight selected value
- Auto-close on selection

**Hover States:**
- Underline on links
- Brightness increase on buttons
- Popover preview on PR/issue titles (500ms delay)

**Loading States:**
- Spinner icon during refresh checks
- Disabled filter dropdowns during initial load
- Skeleton placeholders for PR list

---

## 9. Success Metrics

### 9.1 Adoption Metrics
- **Daily Active Users**: Target 80% of development team
- **Session Duration**: Average 30+ minutes per session
- **Return Rate**: 90% of users return within 24 hours

### 9.2 Performance Metrics
- **Page Load Time**: 95th percentile < 2 seconds
- **Cache Hit Rate**: > 70% of API requests served from cache
- **Auto-Refresh Efficiency**: < 1 second for no-change checks
- **Filter Response Time**: < 200ms for all filter operations

### 9.3 Usage Metrics
- **Filters Used per Session**: Average 2-3 filters applied
- **URL Shares**: 20% of sessions initiated from shared URLs
- **Help Access**: < 10% of sessions require help (indicates good usability)

### 9.4 Business Impact Metrics
- **Code Review Cycle Time**: Reduce by 30% (measured via Bitbucket data)
- **Context Switching**: Reduce Jira/Bitbucket tab switches by 50%
- **PR Merge Time**: Reduce time from creation to merge by 20%
- **Conflict Resolution**: Detect conflicts 50% earlier (before review complete)

---

## 10. Future Roadmap

### 10.1 Planned Features (Next 6 Months)

#### Phase 1: Enhanced Notifications
- Browser notifications for PRs requiring action
- Email digest of daily PR status
- Slack integration for team updates

#### Phase 2: Advanced Analytics
- PR velocity charts (time to merge trends)
- Reviewer workload distribution
- Sprint burndown with PR completion tracking
- Team performance dashboards

#### Phase 3: GitHub Support
- Dual Bitbucket/GitHub support
- Unified view across both platforms
- GitHub Actions integration

#### Phase 4: Collaboration Features
- PR comment integration
- Direct actions (approve, merge) from dashboard
- @mention notifications
- Team chat integration

### 10.2 Technical Improvements

#### Short Term
- Automated testing suite (Jest + testing-library)
- TypeScript migration for type safety
- WebSocket for real-time updates
- Database persistence (PostgreSQL/MongoDB)

#### Medium Term
- Docker containerization
- OAuth authentication (replace Basic Auth)
- Multi-user support with personalized views
- Mobile-responsive design
- Progressive Web App (PWA) capabilities

#### Long Term
- GitLab support
- Azure DevOps integration
- Self-service configuration UI (replace config files)
- API for third-party integrations
- Plugin architecture for extensibility

### 10.3 Potential Enhancements
- AI-powered PR recommendations
- Automated conflict resolution suggestions
- Code review assignment optimization
- Merge risk prediction
- Technical debt tracking integration

---

## 11. Dependencies and Constraints

### 11.1 External Dependencies

**Critical:**
- Bitbucket Cloud/Server instance (API v2.0)
- Jira Cloud/Server instance (API v3)
- Network connectivity to both services

**Optional:**
- Font Awesome CDN (can be vendored)
- Marked.js CDN (can be vendored)

### 11.2 Technical Constraints
- **Single-User Application**: No multi-user authentication/authorization
- **In-Memory Cache**: Lost on server restart
- **Localhost Deployment**: Not designed for production internet deployment
- **No HTTPS**: Security concerns for remote deployment
- **API Rate Limits**: Bitbucket/Jira rate limiting affects refresh frequency
- **Synchronous Processing**: No background job queue for long operations

### 11.3 Organizational Constraints
- **Internal Use Only**: Not licensed for external distribution
- **Developer Workstation Target**: Corporate network access required
- **Manual Installation**: No automated deployment pipeline
- **Self-Service Support**: No dedicated support team

### 11.4 Data Constraints
- **No Historical Data**: Only current state, no time-series storage
- **No Data Export**: Cannot export reports or analytics
- **Cache Limitations**: Max cache size determined by available memory

---

## 12. Out of Scope

The following are explicitly **not** part of current requirements:

### 12.1 Features
- Mobile application (native iOS/Android)
- Public SaaS offering
- User authentication system
- Role-based access control
- PR merge/approve actions directly from dashboard
- Inline code review
- Build/CI pipeline integration
- Automated PR assignment
- Machine learning recommendations

### 12.2 Platforms
- GitHub (not currently supported)
- GitLab (not currently supported)
- Azure DevOps (not currently supported)
- Other issue trackers (Asana, Monday, etc.)

### 12.3 Technical
- Automated testing framework
- Continuous integration/deployment
- Database persistence
- Load balancing/horizontal scaling
- API for external integrations
- Webhooks for event-driven updates

### 12.4 Deployment
- Cloud hosting (AWS, Azure, GCP)
- Container orchestration (Kubernetes)
- Production monitoring/alerting
- Disaster recovery/backup
- Multi-region deployment

---

## 13. Risks and Mitigation

### 13.1 Technical Risks

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Bitbucket API rate limiting | High | Medium | Implement aggressive caching, hash-based change detection |
| Jira API performance degradation | Medium | Low | Cache sprint data for 10 minutes, batch issue fetches |
| Memory leak in long-running server | High | Low | Monitor memory usage, implement cache size limits |
| Breaking API changes from Atlassian | High | Low | Version pin APIs, monitor deprecation notices |
| Large PR volume causing timeout | Medium | Medium | Implement pagination, lazy loading |

### 13.2 Operational Risks

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Credential exposure | High | Low | Git-ignore config.js, use environment variables |
| Server downtime affecting team | Medium | Low | Document manual Bitbucket/Jira workflow fallback |
| Configuration errors breaking app | Medium | Medium | Provide config.js.default template, validation on startup |

### 13.3 User Experience Risks

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Slow load times frustrating users | High | Medium | Performance budget enforcement, caching strategy |
| Filter complexity overwhelming new users | Medium | Medium | Provide online help, smart defaults, tooltips |
| Stale data misleading users | Medium | Low | Show last refresh time prominently, manual refresh button |

---

## 14. Compliance and Security

### 14.1 Data Privacy
- **No PII Storage**: Application does not store personal data
- **Credentials**: Stored locally in config.js (git-ignored)
- **API Tokens**: Never transmitted to client browser
- **Logging**: No sensitive data in logs (credentials, tokens, personal info)

### 14.2 Security Considerations
- **Authentication**: Basic Auth over HTTPS required for production
- **Authorization**: Inherits Bitbucket/Jira permissions of configured user
- **Input Validation**: Minimal (assumes trusted configuration)
- **XSS Protection**: Markdown rendering with sanitization
- **CSRF**: Not applicable (no state-changing operations from client)

### 14.3 Licensing
- **Copyright**: François-Régis Jaunatre
- **License Type**: Proprietary (not open source)
- **Usage Rights**: Internal use only
- **Dependencies**: All npm packages use permissive licenses (MIT/ISC)

---

## 15. Open Questions

### 15.1 Product Questions
- Should we support custom status workflows beyond standard Jira states?
- What is maximum acceptable auto-refresh interval?
- Should we persist user preferences (filter defaults, UI layout)?

### 15.2 Technical Questions
- Is WebSocket worth complexity for real-time updates?
- Should we implement database persistence for analytics?
- What is acceptable memory footprint for cache?

### 15.3 Deployment Questions
- Should we support Docker deployment out of the box?
- Is multi-user authentication a future requirement?
- Should we plan for cloud deployment?

---

## 16. Appendix

### 16.1 Glossary
- **PR**: Pull Request
- **Jira Issue**: Work item in Jira (story, bug, task, etc.)
- **Sprint**: Time-boxed iteration in agile methodology
- **fixVersion**: Jira field indicating target release version
- **Orphaned Issue**: Jira issue marked "In Review" without associated PR
- **SYNC**: Indicator that PR branch is behind its parent branch
- **Commit Ahead**: Number of commits in PR branch not in destination
- **Commit Behind**: Number of commits in destination not in PR branch

### 16.2 References
- Bitbucket API Documentation: https://developer.atlassian.com/cloud/bitbucket/rest/
- Jira REST API: https://developer.atlassian.com/cloud/jira/platform/rest/v3/
- Jira Agile API: https://developer.atlassian.com/cloud/jira/software/rest/
- Node.js Documentation: https://nodejs.org/docs/
- Express.js Guide: https://expressjs.com/

### 16.3 Version History
| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2025-11-18 | François-Régis Jaunatre | Initial PRD creation |

---

**Document Status:** Draft
**Next Review Date:** 2025-12-01
**Approved By:** [Pending]
