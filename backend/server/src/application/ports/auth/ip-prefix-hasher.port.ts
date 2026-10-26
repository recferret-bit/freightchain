/** Privacy boundary: no raw address or browser identifier reaches player sign-in storage. */
export abstract class IpPrefixHasherPort {
  abstract hash(ip: string | null): string | null;
}
