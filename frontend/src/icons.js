// A picture for each menu item, so tickets and trays read at a glance.
export const ICON = { burger: "🍔", fries: "🍟", drink: "🥤", cookie: "🍪" };
export const iconOf = (id) => ICON[id] ?? "🍽️";
