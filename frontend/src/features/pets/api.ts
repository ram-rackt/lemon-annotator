import { request } from "@/lib/api";

export type PetKind = "cat" | "dog";
/**
 * home: its own corner (cat bottom-right, dog bottom-left). free: where its owner dropped it.
 * with: beside the other pet (following it), until its owner sends it home or drags it away.
 */
export type Spot = "home" | "free" | "with";

export interface PetState {
  spot: Spot;
  /** free: where in the window, as fractions of the room the pet can move in. */
  x: number | null;
  y: number | null;
  moved_at: string | null;
  moved_by: string | null;
}

export interface PetMove {
  spot: Spot;
  x?: number;
  y?: number;
}

export interface PetsState {
  /** The pet this account controls. */
  you: PetKind;
  /** Server time of the snapshot. */
  now: string;
  cat: PetState;
  dog: PetState;
  /** The latest time a pet went to the other: both screens play the same activity, picked with `seed`. */
  play: { at: string | null; seed: number };
  /** Browser time this snapshot arrived (added here, not by the API): `now` minus this is the clock offset. */
  receivedAt: number;
}

export const petsApi = {
  get: async (): Promise<PetsState> => ({
    ...(await request<Omit<PetsState, "receivedAt">>("/api/pets")),
    receivedAt: Date.now(),
  }),
  move: async (pet: PetKind, body: PetMove): Promise<PetsState> => ({
    ...(await request<Omit<PetsState, "receivedAt">>(`/api/pets/${pet}`, {
      method: "PUT",
      body: JSON.stringify(body),
    })),
    receivedAt: Date.now(),
  }),
};
