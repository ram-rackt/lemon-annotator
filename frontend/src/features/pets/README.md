# Pets

ankana's cat and ram's dog, for those two accounts only. Each owner controls only their own pet; both see
every move.

- **Click** your pet: it walks to the other pet and they play. It stays beside it (and follows it) until
  you double-click it or drag it away. Clicking again while together starts another game.
- **Drag** your pet anywhere in the window. It stays where you drop it.
- **Double-click** your pet: it goes home (cat bottom-right corner, dog bottom-left corner).
- **Hover** either pet: it wiggles on the spot for 3 seconds.
- **While together** they start a new random activity about every 30 seconds.

Activities (about 5 seconds each, all made from the sticker sheet): badminton, hug, dress-up, nap,
fetch, belly rolls, love note, chase. Both screens play the same one at the same moment: the server picks
a random seed for each play and both screens turn it into the same activity.

Files:

- `config.ts`: which accounts see the pets (by sign-in email) and the timings
- `pets.tsx`: the pets, walking, dragging, clicks and hover
- `activities.ts`: the games they play together
- `geometry.ts`: positions in the window (home corners, dropped spots, beside the other pet)
- `api.ts`: reads and moves the pets through the API (`/api/pets`), checked every 2 seconds
- `sprites/`: cut out of the sticker sheet with transparent backgrounds

Server side: `backend/app/pets/router.py` keeps where each pet is (in memory: after a restart both are
home) and enforces who may move which pet (`LEMON_PET_OWNERS`, default
`ankana@rackt.in:cat,ram@rackt.in:dog`). Everyone else gets a 404, as if the feature didn't exist.

The pets float above the page (fixed position, outside the layout) and only the pets themselves take
clicks, so nothing else in the app changes. To remove the feature, delete this folder, `backend/app/pets/`,
`backend/tests/test_pets.py`, the `<Pets />` line in `src/components/providers.tsx` and the
`pets_router` line in `backend/app/main.py`.
