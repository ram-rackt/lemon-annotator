/**
 * Who gets the pets, by sign-in email: each of these accounts sees both pets and controls its own. Every
 * other account (and Lemon without sign-in) sees nothing. The API has the same list (LEMON_PET_OWNERS)
 * and is what actually enforces it; this copy only saves the other accounts a request.
 */
export const PET_OWNERS = [
  { email: "ankana@rackt.in", name: "ankana", pet: "cat" },
  { email: "ram@rackt.in", name: "ram", pet: "dog" },
] as const;

/** How long the pets play when they meet. */
export const PLAY_MS = 5000;
/** How long the on-the-spot animation lasts while a pet is hovered. */
export const HOVER_MS = 3000;
/** How often each owner's screen checks where the other pet is. */
export const SYNC_MS = 2000;

export function hasPets(email: string | null | undefined): boolean {
  const normalized = email?.trim().toLowerCase();
  return PET_OWNERS.some((owner) => owner.email === normalized);
}

export const ownerOf = (pet: "cat" | "dog") => PET_OWNERS.find((owner) => owner.pet === pet)?.name ?? pet;
