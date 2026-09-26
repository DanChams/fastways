import { env } from 'cloudflare:workers';
import Calendar from './calendar';
export default function Page(){
  const value=(env as unknown as {DRIVE_FOLDER_URL?:string}).DRIVE_FOLDER_URL||'';
  const driveFolderUrl=/^https:\/\/drive\.google\.com\/drive\/folders\/[a-zA-Z0-9_-]+(?:\?.*)?$/.test(value)?value:'';
  return <Calendar driveFolderUrl={driveFolderUrl}/>;
}
