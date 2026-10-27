<p align="center">
	<a href="https://gobernansa.dmoya.dev" target="_blank">
		<img src="/public/logo.svg" width="400" alt="gobernança Logo">
	</a>
</p>

## About gobernança
gobernança is a webapp to help with the management of Neighborhood Associations. Its main features will be:
- [ ] Manage incidences
- [ ] Manage members
- [ ] Timeline of events
- [ ] Actions to take
- [ ] Contact providers


<p align="center">
	<img src="/public/screenshot.png" width="1072" alt="gobernança app screenshots">
</p>

<p align="center">
	<img src="/public/screenshot.gif" width="372" alt="gobernança app gif">
</p>

## Project structure
The code is organised by domain (DDD): each feature lives in its own module under `src/modules`.

```
src/
├── main.ts                 App entry point
├── app/                    App shell: App.vue, router, tabs layout and pages that combine several modules (home, not found)
├── modules/
│   ├── auth/               Login, profile and the signed-in user
│   ├── community/          The user's community and their properties
│   ├── events/             Community events timeline
│   └── issues/             Issues (incidencias) list, detail and creation
├── shared/                 Code used by several modules
│   ├── domain/             Common types (audit fields)
│   ├── infrastructure/     Firebase setup and Firestore helpers
│   ├── ui/                 Reusable components and layouts
│   └── utils/              Generic helpers
└── theme/                  Global styles
```

Every module has the same three folders:
- `domain/` — the module's types and fixed values (statuses, categories…). No Vue or Firebase logic.
- `application/` — composables (`useX.ts`) that load and change the module's data.
- `ui/` — the module's pages (`*Page.vue`) and components.

Rules of thumb:
- Inside a module, import with relative paths (`../domain/issue.ts`). Anything outside the module is imported with the `@/` alias (`@/shared/ui/MainLayout.vue`).
- Code used by a single module belongs in that module, and moves to `shared/` only when a second module needs it.
- Every route is declared in `src/app/router.ts`.

It is a project developed with 💚 by [Daniel Moya](https://dmoya.dev)




