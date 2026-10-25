// The header logo inlined into the monitor bundle. A separate file would sit outside the path of
// ngrok's warning cookie, and the phone would load the warning page instead of the image. The copy
// beside this file is the same image as public/logo-white.png, kept inside src for the boundary check.
import logoWhite from './logo-white.png';

export const monitorLogo: string = logoWhite;
