# 28 — Complete the mobile Session experience

**What to build:** Make the same Pidex hierarchy and complete core Session controls practical in supported mobile browsers and installed PWAs without inventing a second navigation model.

**Blocked by:** 27 — Complete the desktop Session experience

**Status:** resolved

- [ ] The desktop sidebar becomes a slide-over drawer containing the same New Session, Archived, scope groups, state cues, Host status, and settings.
- [ ] Selecting a Session closes the drawer and replaces the one routable main View; browser history remains functional.
- [ ] Timeline, pinned Interaction pager, and composer remain the primary surface with touch-appropriate controls and no modal Interaction takeover.
- [ ] Secondary header actions collapse into overflow while exact-target Stop stays directly reachable during execution.
- [ ] A persistent compact state row appears below the Session header whenever the hidden drawer would conceal non-current Host state.
- [ ] View changes, PWA suspension, standalone launch, and orientation/responsive changes do not affect Session execution or ownership.
- [ ] Browser tests cover supported Android Chrome and iOS/iPadOS Safari browser plus standalone PWA modes for all core Session workflows.
