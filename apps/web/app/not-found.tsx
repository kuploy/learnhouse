import { ArrowRight } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import learnhouseIcon from 'public/black_logo.png'
import { getOrgSlug } from '@services/org/orgResolution'
import { getOrganizationContextInfo } from '@services/organizations/orgs'
import { getOrgLogoMediaDirectory } from '@services/media/media'

// FORK (kuploy-learnhouse#37)
async function currentOrg() {
  try {
    const orgslug = await getOrgSlug()
    return orgslug ? await getOrganizationContextInfo(orgslug, { revalidate: 60, tags: ['organizations'] }) : null
  } catch {
    return null
  }
}

export default async function NotFound() {
  const org = await currentOrg()
  return (
    <div className="flex min-h-screen w-full flex-col items-center justify-center 
   bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-zinc-200 to-slate-300">
    <div className="nx-flex nx-items-center hover:nx-opacity-75 ltr:nx-mr-auto rtl:nx-ml-auto pb-20">
        {org?.logo_image ? (
          <img src={getOrgLogoMediaDirectory(org.org_uuid, org.logo_image)} alt={org.name} className="h-[100px] max-w-[270px] object-contain" />
        ) : (
          <Image quality={100}
          width={270}
          height={100}
          src={learnhouseIcon}
          alt="logo"
        />
        )}
        </div>
      <div className="space-y-6 text-center">
        <h1 className="text-8xl leading-7 font-bold text-black drop-shadow-md">
          404!
        </h1>
        <p className='text-lg pt-8 text-black tracking-tight font-medium leading-normal'>
          We are very sorry for the inconvenience. It looks like you're trying to
          <span className="block">access a page that has been deleted or never existed before</span>
        </p>
      </div>
      <div className='pt-8 flex flex-col items-center'>
      <Link
        href="/"
        className="flex w-fit h-[50px] text-xl space-x-2 bg-black px-6 py-2 text-md rounded-lg font-bold text-white items-center shadow-md gap-2"
      >
        Go back to homepage
        <ArrowRight className="tracking-tight transition-transform duration-150 ease-in-out ml-1" />
      </Link>
    </div>
    </div>
  )
}

