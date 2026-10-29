<p align="center">
	<a href="https://gobernansa.dmoya.dev" target="_blank">
		<img src="/packages/shared/assets/logo.svg" width="400" alt="gobernança Logo">
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
	<img src="/apps/webapp/public/screenshot.png" width="1072" alt="gobernança app screenshots">
</p>

<p align="center">
	<img src="/apps/webapp/public/screenshot.gif" width="372" alt="gobernança app gif">
</p>

## Repository
An npm workspaces monorepo:

| Folder | What |
| --- | --- |
| `apps/webapp` | The neighbours' webapp, at [gobernansa.dmoya.dev](https://gobernansa.dmoya.dev) |
| `apps/admin` | The admin platform, to manage communities and who uses them, at [admin.gobernansa.dmoya.dev](https://admin.gobernansa.dmoya.dev). For everyone but neighbours, each sees the communities they manage (see [roles](docs/firebase.md#roles)) |
| `packages/shared` | Design system (theme, logo), Firebase setup, sign-in and the community domain, used by both apps |

Firebase config, security rules and the seed script stay at the root, and both apps read the `.env` files there. Each push to `main` deploys both apps to their own Firebase Hosting site, see [docs/firebase.md](docs/firebase.md#5-admin-platform-hosting) for the admin's setup.

```bash
npm install
npm run dev        # webapp, https://localhost:5400
npm run dev:admin  # admin, https://localhost:5401
npm run lint && npm run build
```

It is a project developed with 💚 by [Daniel Moya](https://dmoya.dev)




