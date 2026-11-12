// Who runs gobernança, as the LSSI asks every web offering a service to say. Empty until the business is registered (EMP-1):
// the legal pages show the aviso legal once name and nif are filled in
export const holder = {
	name: '',
	nif: '',
	address: '',
	email: '',
};

export const hasHolder = !!(holder.name && holder.nif);
