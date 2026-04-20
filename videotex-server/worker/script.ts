import { fetchJSON } from "~lib/tools";
import { serverSend } from "./videotex";

// apps can send codes and new navigation

abstract class Page {
  static name: string;
  static screen: string;
  codes: string[] = [];
  navigation: Record<string, any> = {};
  abstract render(session: any): Promise<void>;

  async onKey(key: string, _session: any): Promise<Page | null | void> {
    return this.navigation[key] instanceof Page ? this.navigation[key] : null;
  }
}

class Home extends Page {
  static name = "home";
  static screen = "data/cloudflare.raw";

  async render(_session: any, _options?: any) {
    this.codes = [
      "{go(3,8)}{DoubleHeight}{Flash}{AlphaRed}{NewBackground}{AlphaWhite}Cloudflare Agents  {BlackBackground}",
      "{go(6,12)}{AlphaWhite}Videotext Edition",
    ];
    this.navigation = { "2": new Weather(), "3": new Bart() };
  }
}

class Weather extends Page {
  static name = "weather";
  static screen = "data/weather.raw";

  async render(session: any, options?: any) {
    const lat = options?.latitude ?? session.cf.latitude;
    const lon = options?.longitude ?? session.cf.longitude;
    const temp: any = await fetchJSON(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m`,
    );
    const geo: any = await fetchJSON(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`,
    );
    if (temp && geo) {
      this.codes = [
        `{go(2,0)} ${geo.address.city}, ${geo.address.country}{GraphicsRed}`,
        `{go(3,0)} Temp is ${temp.current.temperature_2m}C{GraphicsRed}`,
      ];
    } else {
      this.codes = ["{go(6,12)}Yellow"];
    }
    this.navigation = { "1": new Home(), "2": "new york" };
  }

  async onKey(key: string, session: any): Promise<Page | null | void> {
    switch (key) {
      case "2":
        await this.render(session, { latitude: 40.7128, longitude: -74.006 });
        await serverSend(session, this.codes);
        break;
      default:
        return super.onKey(key, session);
    }
  }
}

class Bart extends Page {
  static name = "bart";
  static screen = "data/bart.raw";

  async render(_session: any) {
    this.navigation = { "1": new Home() };
  }
}

export const entrypointScreen = new Home();
