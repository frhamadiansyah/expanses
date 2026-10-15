/** A count of points, miles or cashback as the app writes it everywhere: "12.345". A plain module, so a model can use it. */
export const formatPoints = (n: number) => n.toLocaleString('id-ID');
