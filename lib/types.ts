export type Asset={id:string;name:string;url:string;type:string;size:number};
export type Post={id:string;title:string;date:string;project:string;status:string;caption:string;comment:string;drive:string;assets:Asset[];thumbnail?:Asset|null;updated:string};
