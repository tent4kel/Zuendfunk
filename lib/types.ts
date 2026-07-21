export type Episode = {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  title: string;
  presenters?: string;
  detailUrl?: string;
  imageUrl?: string;
  description?: string;
  streamUrl: string;
  hasAired: boolean;
};
